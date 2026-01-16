# Let's try Selenium

import time
from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.firefox import GeckoDriverManager

def get_driver():
    """
    Robust driver factory that attempts to initialize Chrome, then Firefox, then Safari.
    Returns a WebDriver instance or None.
    """
    # 1. Try Chrome
    try:
        options = ChromeOptions()
        options.add_argument("--headless=new")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        return webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=options)
    except Exception as e:
        print(f"   ⚠️ Chrome failed to start: {e}")

    # 2. Try Firefox
    try:
        options = FirefoxOptions()
        options.add_argument("--headless")
        return webdriver.Firefox(service=FirefoxService(GeckoDriverManager().install()), options=options)
    except Exception as e:
        print(f"   ⚠️ Firefox failed to start: {e}")

    # 3. Try Safari (MacOS only, built-in)
    try:
        return webdriver.Safari()
    except Exception as e:
        print(f"   ⚠️ Safari failed to start: {e}")

    return None

def scrape_links_selenium(site_name, destination):
    """
    Main entry point for Selenium scraping. 
    Routes to specific site logic based on site_name.
    """
    driver = get_driver()
    if not driver:
        print("   ❌ CRITICAL: No compatible browser found for Selenium.")
        return []

    results = []
    print(f"   🤖 Selenium driver active ({driver.name}). Processing {site_name}...")

    try:
        if site_name == "Travellerspoint":
            results = _scrape_travellerspoint(driver, destination)
        # Add other sites here as needed (elif site_name == "TripAdvisor"...)
        else:
            print(f"   ⚠️ No Selenium logic defined for {site_name}")

    except Exception as e:
        print(f"   ❌ Selenium Error: {e}")
    finally:
        driver.quit()
    
    return results

def _scrape_travellerspoint(driver, destination):
    url = f"https://www.travellerspoint.com/search.cfm?q={destination}"
    driver.get(url)
    
    print("   ⏳ Waiting for Google CSE results...")
    try:
        # Wait specifically for the Google CSE container
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "div.gsc-webResult"))
        )
    except:
        print("   ⚠️ Timeout waiting for results.")
        return []

    elements = driver.find_elements(By.CSS_SELECTOR, "div.gsc-webResult.gsc-result")
    valid_results = []

    for res in elements:
        try:
            title_elem = res.find_element(By.CSS_SELECTOR, "a.gs-title")
            title = title_elem.text.strip()
            link = title_elem.get_attribute("href")
            
            if title and link and "google.com" not in link:
                valid_results.append({'Site': 'Travellerspoint', 'Title': title, 'Link': link})
        except:
            continue
    
    return valid_results[:5] # Limit to top 5