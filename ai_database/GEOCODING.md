# Geocoding Provider Configuration

The AI processor supports multiple geocoding providers for converting location names to coordinates.

## Supported Providers

### 1. **Nominatim (OpenStreetMap)** - Default, Free
- **Cost**: Free
- **Rate Limit**: 1 request per second
- **Quality**: Good for most locations
- **Setup**: No API key needed (default)

```env
GEO_PROVIDER=nominatim
```

### 2. **Google Maps Geocoding API** - Recommended
- **Cost**: $5 per 1,000 requests (first $200/month free = 40,000 free requests)
- **Rate Limit**: 50 requests per second
- **Quality**: Best accuracy and global coverage
- **Setup**: 
  1. Enable Google Maps Geocoding API in Google Cloud Console
  2. Create an API key
  3. Add to `.env`:

```env
GEO_PROVIDER=google
GOOGLE_MAPS_API_KEY=your_api_key_here
```

### 3. **Mapbox Geocoding API**
- **Cost**: First 100,000 requests free, then $0.50 per 1,000
- **Rate Limit**: 600 requests per minute
- **Quality**: Very good
- **Setup**:

```env
GEO_PROVIDER=mapbox
MAPBOX_API_KEY=your_api_key_here
```

## GitHub Actions Setup

For the nightly workflow, add these secrets in your repository:

1. Go to: **Settings → Secrets and variables → Actions**
2. Add:
   - `GEO_PROVIDER` = `google` (or `nominatim`, `mapbox`)
   - `GOOGLE_MAPS_API_KEY` = your API key (if using Google)
   - `MAPBOX_API_KEY` = your API key (if using Mapbox)

## Performance Comparison

| Provider | Speed | Quality | Cost | Best For |
|----------|-------|---------|------|----------|
| Nominatim | Slow (1.2s delay) | Good | Free | Small projects, testing |
| Google Maps | Fast (0.1s delay) | Excellent | Paid | Production, high accuracy |
| Mapbox | Fast (0.1s delay) | Very Good | Generous free tier | Medium projects |

## Recommendation

**For production use**: Switch to Google Maps API for:
- 50x faster geocoding (no 1-second wait between requests)
- Better accuracy for international locations
- More reliable service

**For development/testing**: Nominatim is fine and costs nothing.

## Cost Estimate

With nightly runs processing ~25 locations:
- **Per run**: ~50-100 geocoding requests
- **Per month**: ~1,500-3,000 requests
- **Google Maps cost**: $0-$7.50/month (likely within free tier)
