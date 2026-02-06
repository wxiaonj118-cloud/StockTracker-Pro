from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import requests
import os
import pandas as pd
import talib
from openai import OpenAI
from dotenv import load_dotenv
import json
from datetime import datetime

# ========== 1. LOAD CONFIGURATION ==========
load_dotenv()
ITICK_API_TOKEN = os.getenv('ITICK_API_TOKEN')
TWELVEDATA_API_KEY = os.getenv('TWELVEDATA_API_KEY')
DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')  # New: Load DeepSeek key
ITICK_BASE_URL = "https://api.itick.org"

if not ITICK_API_TOKEN or ITICK_API_TOKEN == "YOUR_ACTUAL_ITICK_API_KEY_GOES_HERE":
    print("❌ ERROR: iTick API Token not found or is the default placeholder.")
    print("   Please check your .env file in the backend folder.")
    exit(1)

if not DEEPSEEK_API_KEY:
    print("⚠️  WARNING: DEEPSEEK_API_KEY not found in .env file.")
    print("   AI analysis features will not work.")

# Initialize DeepSeek Client (if key is available)
deepseek_client = None
if DEEPSEEK_API_KEY and DEEPSEEK_API_KEY != "your_deepseek_api_key_here":
    try:
        deepseek_client = OpenAI(
            api_key=DEEPSEEK_API_KEY,
            base_url="https://api.deepseek.com"
        )
        print("✅ DeepSeek AI client initialized successfully.")
    except Exception as e:
        print(f"❌ Failed to initialize DeepSeek client: {e}")
        deepseek_client = None

# ========== 2. INITIALIZE FLASK APP ==========
app = Flask(__name__)
CORS(app)

# ========== 3. MAIN HTML ROUTE (MUST COME FIRST!) ==========
@app.route('/')
def index():
    """Serve the main frontend HTML page."""
    return render_template('stockTrackerPro.html')

# ========== 4. API HEALTH CHECK ROUTE ==========
@app.route('/api/health')
def health_check():
    """Simple route to verify the backend is running (API endpoint)."""
    return jsonify({
        "message": "Stock Data API Backend is running.",
        "status": "ok",
        "supported_markets": ["US"],
        "usage": [
            "GET /api/stock/<region>/<symbol> (e.g., /api/stock/US/AAPL)",
            "GET /api/historical/<region>/<symbol> (e.g., /api/historical/US/AAPL?kType=8&limit=100)",
            "GET /api/search/<query> (e.g., /api/search/AAPL)",
            "GET /api/indices",
            "GET /api/analyze/<region>/<symbol> (e.g., /api/analyze/US/AAPL)"
        ]
    })

# ========== 5. HELPER FUNCTION: CALCULATE TECHNICAL INDICATORS ==========
def calculate_technical_indicators(historical_df, current_price):
    """
    Calculates key technical indicators from historical DataFrame.
    Returns a dictionary of calculated values.
    """
    if historical_df is None or historical_df.empty:
        return None
    
    try:
        # Ensure we have numeric data
        closes = pd.to_numeric(historical_df['c'], errors='coerce').values
        
        # Calculate indicators using TA-Lib
        indicators = {}
        
        # Moving Averages
        indicators['ma_20'] = talib.SMA(closes, timeperiod=20)[-1] if len(closes) >= 20 else None
        indicators['ma_50'] = talib.SMA(closes, timeperiod=50)[-1] if len(closes) >= 50 else None
        indicators['ma_200'] = talib.SMA(closes, timeperiod=200)[-1] if len(closes) >= 200 else None
        
        # RSI (Relative Strength Index)
        indicators['rsi'] = talib.RSI(closes, timeperiod=14)[-1] if len(closes) >= 14 else None
        
        # Volatility (Standard Deviation of recent price changes)
        historical_df['returns'] = pd.to_numeric(historical_df['c']).pct_change()
        indicators['volatility_30d'] = historical_df['returns'].tail(30).std() * (252 ** 0.5)  # Annualized
        
        # Price levels
        indicators['high_52w'] = pd.to_numeric(historical_df['h']).max()
        indicators['low_52w'] = pd.to_numeric(historical_df['l']).min()
        
        # Current price position
        indicators['current_price'] = float(current_price) if current_price else closes[-1]
        
        # Determine trend vs moving averages
        if indicators['ma_50']:
            indicators['vs_ma50'] = 'above' if indicators['current_price'] > indicators['ma_50'] else 'below'
        else:
            indicators['vs_ma50'] = None
            
        if indicators['ma_200']:
            indicators['vs_ma200'] = 'above' if indicators['current_price'] > indicators['ma_200'] else 'below'
        else:
            indicators['vs_ma200'] = None
            
        # Round values for readability
        for key in ['ma_20', 'ma_50', 'ma_200', 'rsi', 'volatility_30d', 'high_52w', 'low_52w', 'current_price']:
            if indicators[key] is not None:
                indicators[key] = round(float(indicators[key]), 2)
        
        return indicators
        
    except Exception as e:
        print(f"Error calculating indicators: {e}")
        return None

# ========== 6. YOUR EXISTING API ROUTES (UNCHANGED) ==========
@app.route('/api/stock/<region>/<code>', methods=['GET'])
def get_stock_quote(region, code):
    """
    Fetches a stock quote from iTick API.
    Example: GET /api/stock/US/AAPL
    """
    print(f"[LOG] Received request for {region}:{code}")

    url = f"{ITICK_BASE_URL}/stock/quote?region={region}&code={code}"
    headers = {"accept": "application/json", "token": ITICK_API_TOKEN}

    try:
        api_response = requests.get(url, headers=headers, timeout=10)
        api_data = api_response.json()

        if api_response.status_code == 200 and api_data.get("code") == 0:
            stock_data = api_data.get("data")

            if stock_data:
                return jsonify({
                    "status": "success",
                    "region": region,
                    "symbol": code,
                    "data": stock_data
                })
            else:
                return jsonify({
                    "status": "error",
                    "message": f"No data available for {region}:{code}.",
                    "code": "NO_DATA"
                }), 404
        else:
            return jsonify({
                "status": "error",
                "message": api_data.get("msg", "Unknown error from data provider"),
                "provider_code": api_data.get("code")
            }), 400

    except requests.exceptions.Timeout:
        return jsonify({"status": "error", "message": "Request to data provider timed out."}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({"status": "error", "message": f"Failed to fetch data: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"status": "error", "message": f"An unexpected server error occurred."}), 500

@app.route('/api/historical/<region>/<code>', methods=['GET'])
def get_historical_data(region, code):
    """
    Fetches historical candlestick data from iTick API.
    Example: GET /api/historical/US/AAPL?kType=8&limit=100
    """
    print(f"[LOG] Historical data request for {region}:{code}")
    
    # Get optional parameters from the request, with defaults
    k_type = request.args.get('kType', default='8', type=str)  # 8 = daily data
    limit = request.args.get('limit', default='100', type=str)  # Default 100 candlesticks
    
    # Construct the iTick API URL using your existing ITICK_BASE_URL
    # The historical endpoint is /stock/kline
    url = f"{ITICK_BASE_URL}/stock/kline?region={region}&code={code}&kType={k_type}&limit={limit}"
    headers = {"accept": "application/json", "token": ITICK_API_TOKEN}

    try:
        api_response = requests.get(url, headers=headers, timeout=10)
        api_data = api_response.json()

        if api_response.status_code == 200 and api_data.get("code") == 0:
            historical_data = api_data.get("data", [])
            
            if historical_data:
                return jsonify({
                    "status": "success",
                    "region": region,
                    "symbol": code,
                    "interval": k_type,
                    "data": historical_data
                })
            else:
                return jsonify({
                    "status": "error",
                    "message": f"No historical data available for {region}:{code}.",
                    "code": "NO_HISTORICAL_DATA"
                }), 404
        else:
            return jsonify({
                "status": "error",
                "message": api_data.get("msg", "Unknown error from data provider"),
                "provider_code": api_data.get("code")
            }), 400

    except requests.exceptions.Timeout:
        return jsonify({"status": "error", "message": "Request to data provider timed out."}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({"status": "error", "message": f"Failed to fetch historical data: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"status": "error", "message": f"An unexpected server error occurred: {str(e)}"}), 500

@app.route('/api/search/<query>', methods=['GET'])
def search_symbols(query):
    """
    Securely searches for stock symbols using Twelve Data API,
    filtering for US stocks only.
    """
    if not TWELVEDATA_API_KEY:
        return jsonify({"error": "Search API key not configured."}), 500

    url = f"https://api.twelvedata.com/symbol_search?symbol={query}&apikey={TWELVEDATA_API_KEY}"

    try:
        response = requests.get(url, timeout=5)
        data = response.json()
        
        # Filter for US stocks only
        if 'data' in data and data['data']:
            us_stocks = []
            
            for item in data['data']:
                # Check multiple possible fields for US identification
                country = item.get('country', '').upper()
                exchange = item.get('exchange', '').upper()
                mic_code = item.get('mic_code', '').upper()
                
                # Filter conditions for US stocks
                is_us_stock = (
                    country == 'UNITED STATES' or
                    country == 'US' or
                    country == 'USA' or
                    'NASDAQ' in exchange or
                    'NYSE' in exchange or
                    'AMEX' in exchange or
                    'XNAS' in mic_code or  # NASDAQ MIC code
                    'XNYS' in mic_code or  # NYSE MIC code
                    'XASE' in mic_code     # AMEX MIC code
                )
                
                if is_us_stock:
                    us_stocks.append(item)
                    
                    # Limit to 8 results for better UX
                    if len(us_stocks) >= 8:
                        break
            
            # Return filtered results
            return jsonify({
                "data": us_stocks,
                "status": "success",
                "message": f"Found {len(us_stocks)} US stocks matching '{query}'"
            })
        else:
            return jsonify({
                "data": [],
                "status": "success",
                "message": f"No US stocks found for '{query}'"
            })
            
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Search failed: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500

# ========== 7. ADD MAJOR INDICES ROUTE (FIXED VERSION) ==========
@app.route('/api/indices', methods=['GET'])
def get_major_indices():
    """
    Fetches data for major US indices that are available on the free plan.
    Currently confirmed: S&P 500 (SPX)
    """
    indices_to_fetch = [
        {'name': 'S&P 500', 'code': 'SPX', 'region': 'GB'},        
        {'name': 'NASDAQ Composite', 'code': 'IXIC', 'region': 'GB'},
        {'name': 'Dow Jones Industrial', 'code': 'DJI', 'region': 'GB'},
    ]
    
    indices_data = []
    
    for index in indices_to_fetch:
        url = f"{ITICK_BASE_URL}/indices/quote?region={index['region']}&code={index['code']}"
        headers = {"accept": "application/json", "token": ITICK_API_TOKEN}
        
        try:
            response = requests.get(url, headers=headers, timeout=5)
            api_data = response.json()
            
            if response.status_code == 200 and api_data.get("code") == 0:
                quote_data = api_data.get("data")
                
                # Check if we actually got price data
                if isinstance(quote_data, dict):
                    indices_data.append({
                        'name': index['name'],
                        'symbol': index['code'],
                        'last_price': quote_data.get('ld', 0),
                        'change': quote_data.get('ch', 0),
                        'change_percent': quote_data.get('chp', 0),
                    })
                else:
                    # API returned success but no data (like with COMP)
                    print(f"[INFO] No data available for {index['name']} ({index['code']})")
            else:
                # API returned an error
                print(f"[INFO] Could not fetch {index['name']}: {api_data.get('msg', 'Unknown error')}")
                
        except Exception as e:
            print(f"[ERROR] Failed to fetch {index['name']}: {str(e)}")
    
    return jsonify({
        "status": "success",
        "data": indices_data,
        "message": f"Found {len(indices_data)} available index(es)"
    })

# ========== 8. NEW AI ANALYSIS ROUTE ==========
@app.route('/api/analyze/<region>/<code>', methods=['GET'])
def analyze_stock(region, code):
    """
    AI-powered stock analysis endpoint.
    Fetches real-time and historical data, calculates indicators,
    and generates AI analysis using DeepSeek.
    Example: GET /api/analyze/US/AAPL
    """
    print(f"[LOG] AI Analysis request for {region}:{code}")
    
    # Check if DeepSeek client is available
    if not deepseek_client:
        return jsonify({
            "status": "error",
            "message": "AI analysis service is not configured. Check your DEEPSEEK_API_KEY in .env file."
        }), 503
    
    # 1. Fetch real-time quote
    quote_url = f"{ITICK_BASE_URL}/stock/quote?region={region}&code={code}"
    quote_headers = {"accept": "application/json", "token": ITICK_API_TOKEN}
    
    try:
        quote_response = requests.get(quote_url, headers=quote_headers, timeout=10)
        quote_data = quote_response.json()
        
        if quote_response.status_code != 200 or quote_data.get("code") != 0:
            return jsonify({
                "status": "error",
                "message": f"Could not fetch real-time data for {code}: {quote_data.get('msg', 'Unknown error')}"
            }), 400
        
        realtime_data = quote_data.get("data", {})
        current_price = realtime_data.get('ld')
        
        if not current_price:
            return jsonify({
                "status": "error",
                "message": f"No current price available for {code}"
            }), 404
            
    except requests.exceptions.RequestException as e:
        return jsonify({
            "status": "error",
            "message": f"Failed to fetch real-time data: {str(e)}"
        }), 502
    
    # 2. Fetch historical data (100 days for indicator calculation)
    historical_url = f"{ITICK_BASE_URL}/stock/kline?region={region}&code={code}&kType=8&limit=100"  # FIXED: Removed extra }
    historical_headers = {"accept": "application/json", "token": ITICK_API_TOKEN}
    
    try:
        hist_response = requests.get(historical_url, headers=historical_headers, timeout=10)
        hist_data = hist_response.json()
        
        if hist_response.status_code != 200 or hist_data.get("code") != 0:
            return jsonify({
                "status": "error",
                "message": f"Could not fetch historical data for {code}"
            }), 400
        
        historical_list = hist_data.get("data", [])
        
        if not historical_list:
            return jsonify({
                "status": "error",
                "message": f"No historical data available for {code}"
            }), 404
            
        # Convert to DataFrame for calculation
        historical_df = pd.DataFrame(historical_list)
        
    except requests.exceptions.RequestException as e:
        return jsonify({
            "status": "error",
            "message": f"Failed to fetch historical data: {str(e)}"
        }), 502
    
    # 3. Calculate technical indicators
    indicators = calculate_technical_indicators(historical_df, current_price)
    
    if not indicators:
        return jsonify({
            "status": "error",
            "message": f"Failed to calculate technical indicators for {code}"
        }), 500
    
    # 4. Prepare AI context
    analysis_context = {
        "symbol": code,
        "region": region,
        "current_price": indicators['current_price'],
        "price_change": realtime_data.get('ch', 0),
        "price_change_percent": realtime_data.get('chp', 0),
        "moving_average_20": indicators['ma_20'],
        "moving_average_50": indicators['ma_50'],
        "moving_average_200": indicators['ma_200'],
        "position_vs_ma50": indicators['vs_ma50'],
        "position_vs_ma200": indicators['vs_ma200'],
        "rsi": indicators['rsi'],
        "volatility_annualized": indicators['volatility_30d'],
        "52_week_high": indicators['high_52w'],
        "52_week_low": indicators['low_52w'],
        "volume": realtime_data.get('v', 0),
        "analysis_timestamp": datetime.utcnow().isoformat()
    }
    
    # 5. Prepare AI prompt
    system_prompt = """You are a professional financial analyst. Analyze the provided stock metrics and generate a concise report.
    Respond with a valid JSON object containing exactly these 6 keys with 1-2 sentence values:
    1. "trend_analysis": Comment on short/medium-term trend and moving average position.
    2. "volatility_insight": Note the volatility level and what it suggests.
    3. "pattern_recognition": Identify any notable patterns or context (e.g., earnings season).
    4. "summary": A natural language summary of the stock's current situation.
    5. "risk_commentary": Note any overbought/oversold conditions or risk factors.
    6. "general_observation": A neutral, non-personalized technical observation.
    
    Base your analysis strictly on the provided data. Be objective and avoid speculation."""
    
    user_prompt = f"Please analyze this stock data: {json.dumps(analysis_context, indent=2)}"
    
    # 6. Call DeepSeek API
    try:
        ai_response = deepseek_client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=600,
            temperature=0.3
        )
        
        ai_content = ai_response.choices[0].message.content
        
        # Parse the JSON response
        ai_analysis = json.loads(ai_content)
        
        # Return combined result
        return jsonify({
            "status": "success",
            "symbol": code,
            "region": region,
            "technical_indicators": analysis_context,
            "ai_analysis": ai_analysis,
            "timestamp": datetime.utcnow().isoformat()
        })
        
    except json.JSONDecodeError:
        return jsonify({
            "status": "error",
            "message": "AI returned invalid JSON format",
            "raw_response": ai_content if 'ai_content' in locals() else "No response"
        }), 500
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"AI analysis failed: {str(e)}"
        }), 500

# ========== 9. RUN THE APPLICATION ==========
if __name__ == '__main__':
    print("=" * 60)
    print("Starting Flask Stock Data Backend with AI Analysis...")
    print(f"iTick API Key Loaded: {'Yes' if ITICK_API_TOKEN else 'No'}")
    print(f"DeepSeek AI Client: {'Ready' if deepseek_client else 'Not Configured'}")
    print("Server will run at: http://127.0.0.1:5000")
    print("\nAvailable Endpoints:")
    print("  • Web Interface:       /")
    print("  • API Health Check:    /api/health")
    print("  • Real-time quote:     /api/stock/US/AAPL")
    print("  • Historical data:     /api/historical/US/AAPL?kType=8&limit=100")
    print("  • Symbol search:       /api/search/AAPL")
    print("  • Major indices:       /api/indices")
    print("  • AI Analysis:         /api/analyze/US/AAPL")
    print("=" * 60)
    app.run(debug=True, port=5000)