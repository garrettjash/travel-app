import json
import os
import boto3
import tempfile
from typing import List, Optional
from pydantic import BaseModel, Field
from openai import OpenAI
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

# --- CONFIGURATION ---
S3_BUCKET = os.getenv("S3_BUCKET_NAME")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") # Use Service Role for writes

# --- CLIENTS ---
s3 = boto3.client('s3', 
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
)
openai_client = OpenAI(api_key=OPENAI_API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- SCHEMA DEFINITIONS (AI OUTPUT) ---
class ExtractedAttraction(BaseModel):
    name: str = Field(..., description="Official name of the attraction")
    category: str = Field(..., description="General category: Landmark, Museum, Park, Food, Shopping, etc.")
    vibes: List[str] = Field(..., description="3-5 adjectives describing the mood (e.g. 'Crowded', 'Futuristic')")
    logistics: dict = Field(..., description="Key-value pairs of facts (price, hours, metro station)")
    description_summary: str = Field(..., description="A 2-3 sentence master summary of the place.")
    source_opinion_summary: str = Field(..., description="What THIS specific article says about the place.")
    implied_sentiment_score: float = Field(..., description="0.0 to 10.0 score based on the author's tone")

class ArticleExtraction(BaseModel):
    attractions: List[ExtractedAttraction]

# --- FUNCTIONS ---

def download_s3_file(s3_key):
    """Downloads a file from S3 to a temporary local file."""
    print(f"⬇️  Downloading {s3_key} from S3...")
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        s3.download_fileobj(S3_BUCKET, s3_key, tmp)
        return tmp.name

def analyze_chunk_with_ai(text_chunk, title, source_name):
    """Sends text to OpenAI to extract structured data."""
    print(f"   🧠 Analyzing chunk ({len(text_chunk)} chars)...")
    prompt = f"""
    You are a Travel Data Extractor.
    Source: {source_name}
    Article Title: {title}
    
    Extract specific tourist attractions mentioned in the text below.
    Ignore generic advice. Focus on distinct venues/locations.
    
    For 'logistics', extract facts like prices, hours, or addresses into a JSON dict.
    For 'source_opinion_summary', summarize exactly what THIS author thinks.
    """

    try:
        completion = openai_client.beta.chat.completions.parse(
            model="gpt-4o-mini", # Cheap & Fast
            messages=[
                {"role": "system", "content": "Extract structured travel data."},
                {"role": "user", "content": f"{prompt}\n\nTEXT:\n{text_chunk[:15000]}"} 
            ],
            response_format=ArticleExtraction,
        )
        return completion.choices[0].message.parsed.attractions
    except Exception as e:
        print(f"   ⚠️ AI Error: {e}")
        return []

def save_to_supabase(attractions: List[ExtractedAttraction], raw_article, s3_key):
    """The ETL Step: Transforms AI objects into DB Rows."""
    
    # 1. Get/Create the Source
    source_res = supabase.table('sources').select('id').eq('domain', raw_article['source']).execute()
    if source_res.data:
        source_id = source_res.data[0]['id']
    else:
        # Create new source
        new_source = supabase.table('sources').insert({
            'name': raw_article['source'],
            'domain': raw_article['source'], # You might want to clean this to actual domain later
            'base_trust_score': 50
        }).execute()
        source_id = new_source.data[0]['id']

    # 2. Get/Create the Place (Anchor) - Assuming Shanghai for now based on file
    # In prod, you'd extract this from the filename or a meta field
    place_name = "Shanghai" 
    place_res = supabase.table('places').select('id').ilike('name', place_name).execute()
    if place_res.data:
        place_id = place_res.data[0]['id']
    else:
        # Create Place (Simple fallback)
        new_place = supabase.table('places').insert({
            'name': place_name, 'country_region': 'China', 
            'place_type': 'city', 'latitude': 31.23, 'longitude': 121.47
        }).execute()
        place_id = new_place.data[0]['id']

    count = 0
    for item in attractions:
        # 3. Create/Get Attraction
        # Upsert based on Name + Place to avoid duplicates
        # Note: In prod, you might need smarter fuzzy matching than just name
        attraction_data = {
            'place_id': place_id,
            'name': item.name,
            'description_summary': item.description_summary, # NOTE: This overwrites. In future, use AI to merge.
            'vibes': item.vibes,
            'raw_data': item.logistics,
            'latitude': 0.0, 'longitude': 0.0 # Placeholder, would need Geocoding API step here
        }
        
        # Check if exists
        exist = supabase.table('attractions').select('id').eq('name', item.name).eq('place_id', place_id).execute()
        if exist.data:
            attraction_id = exist.data[0]['id']
            # Optional: Update vibes/summary here
        else:
            new_attr = supabase.table('attractions').insert(attraction_data).execute()
            attraction_id = new_attr.data[0]['id']

        # 4. Create Attraction_Source Link (The Evidence)
        link_data = {
            'attraction_id': attraction_id,
            'source_id': source_id,
            'source_url': raw_article['url'],
            'raw_content_body': raw_article.get('content_body', '')[:1000], # Store snippet or full
            'source_summary': item.source_opinion_summary,
            'rating': item.implied_sentiment_score,
            's3_source_file': s3_key # TRACEABILITY!
        }
        
        try:
            supabase.table('attraction_sources').insert(link_data).execute()
            count += 1
        except Exception as e:
            # Duplicate key error likely (already linked)
            pass

    print(f"   ✅ Saved {count} attractions to Supabase.")

def process_pipeline(s3_key_to_process):
    local_path = download_s3_file(s3_key_to_process)
    
    with open(local_path, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip(): continue
            article = json.loads(line)
            print(f"\nProcessing Article: {article.get('title', 'Unknown')}")
            
            # Use 'content_body' if available (from your new scraper), else 'content'
            text_to_analyze = article.get('content_body', article.get('content', ''))
            
            if not text_to_analyze:
                print("   ⚠️ No content found, skipping.")
                continue

            # Run AI
            extracted_data = analyze_chunk_with_ai(text_to_analyze, article['title'], article['source'])
            
            # Save DB
            if extracted_data:
                save_to_supabase(extracted_data, article, s3_key_to_process)

    os.remove(local_path)
    print("\n🎉 Processing Complete.")

# --- EXECUTION ---
if __name__ == "__main__":
    # Example: Process the file you uploaded
    # In production, this would be an argument or an event trigger
    process_pipeline("raw_scrapes/shanghai_data.jsonl")