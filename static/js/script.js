// ==================== MAIN INITIALIZATION ====================
// Wait for the DOM to be fully loaded before accessing elements
document.addEventListener('DOMContentLoaded', function() {
    // ==================== CONFIGURATION ====================
    // Your Flask backend URL (running locally)
    const BACKEND_URL = 'http://127.0.0.1:5000';

    // ==================== GET DOM ELEMENTS ====================
    const regionSelect = document.getElementById('stockRegion');
    const symbolSearchInput = document.getElementById('symbolSearch');
    const autocompleteResultsDiv = document.getElementById('autocompleteResults');
    const hiddenSymbolInput = document.getElementById('stockSymbol'); // The hidden input storing final symbol
    const fetchBtn = document.getElementById('fetchBtn');
    const loadingDiv = document.getElementById('loading');
    const resultDiv = document.getElementById('resultContainer');
    const chartSection = document.getElementById('chartSection'); // New: Chart section element

    // Debug: Check if elements exist
    console.log('DOM Loaded - Checking elements:');
    console.log('fetchBtn:', fetchBtn);
    console.log('symbolSearchInput:', symbolSearchInput);
    console.log('regionSelect:', regionSelect);
    console.log('chartSection:', chartSection);
    
    // If any element is null, we have an HTML problem
    if (!fetchBtn || !symbolSearchInput || !regionSelect) {
        console.error('ERROR: One or more DOM elements not found! Check HTML IDs.');
        alert('Page initialization failed. Please check console for errors.');
        return;
    }

    // ==================== CHART GLOBALS ====================
    let stockChartInstance = null; // Holds the current Chart.js instance
    let currentSymbol = null; // Tracks the currently displayed symbol
    let currentChartRequestController = null; // For aborting previous chart requests

    // ==================== EVENT LISTENERS ====================
    fetchBtn.addEventListener('click', fetchStockData);
    symbolSearchInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            fetchStockData();
        }
    });

    // ==================== SYMBOL SEARCH / AUTOCOMPLETE ====================
    // Trigger search 300ms after user stops typing (debouncing)
    let searchTimeout;
    
    symbolSearchInput.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        const searchTerm = this.value;
        searchTimeout = setTimeout(() => fetchSearchSuggestions(searchTerm), 300);
    });

    // When user clicks on a suggestion in the dropdown
    autocompleteResultsDiv.addEventListener('click', function(event) {
        const clickedItem = event.target.closest('.autocomplete-item');
        if (clickedItem) {
            const selectedSymbol = clickedItem.getAttribute('data-symbol');
            // 1. Put the symbol in the hidden input (for quote fetch)
            hiddenSymbolInput.value = selectedSymbol;
            // 2. Show a nice summary in the search box for the user
            const companyName = clickedItem.querySelector('strong').nextSibling.textContent.trim();
            symbolSearchInput.value = `${selectedSymbol} - ${companyName}`;
            // 3. Hide the dropdown
            hideAutocomplete();
        }
    });

    // FIXED: Hide dropdown if user clicks elsewhere on the page
    document.addEventListener('click', function(event) {
        const searchContainer = event.target.closest('.search-container');
        const autocompleteItem = event.target.closest('.autocomplete-item');
        
        // If click is NOT inside search-container AND NOT on an autocomplete item
        if (!searchContainer && !autocompleteItem) {
            hideAutocomplete();
        }
    });

    // Optional: Also close dropdown when pressing Escape key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            hideAutocomplete();
        }
    });

    // Secure function: calls YOUR Flask backend to search symbols
    async function fetchSearchSuggestions(searchTerm) {
        if (!searchTerm || searchTerm.length < 2) {
            hideAutocomplete();
            return;
        }

        // Call your secure Flask backend route
        const url = `${BACKEND_URL}/api/search/${encodeURIComponent(searchTerm)}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.data && data.data.length > 0) {
                displayAutocompleteResults(data.data);
            } else {
                hideAutocomplete();
            }
        } catch (error) {
            console.error('Search API error:', error);
            hideAutocomplete();
        }
    }

    // Display search results in the dropdown
    function displayAutocompleteResults(results) {
        // Limit to first 8 results for clarity
        const limitedResults = results.slice(0, 8);

        const resultsHtml = limitedResults.map(item => `
            <div class="autocomplete-item" data-symbol="${item.symbol}">
                <strong>${item.symbol}</strong> - ${item.instrument_name}
                <div class="autocomplete-sub">${item.exchange} | ${item.country}</div>
            </div>
        `).join('');

        autocompleteResultsDiv.innerHTML = resultsHtml;
        autocompleteResultsDiv.style.display = 'block';
    }

    function hideAutocomplete() {
        autocompleteResultsDiv.style.display = 'none';
    }

    // ==================== FETCH STOCK QUOTE ====================
    // Main function to fetch stock data from your backend
    async function fetchStockData() {
        const region = regionSelect.value;
        // Use the symbol from the HIDDEN input (set when user selects from dropdown)
        const symbol = hiddenSymbolInput.value.trim().toUpperCase();

        if (!symbol) {
            alert('Please search for and select a company from the dropdown list.');
            return;
        }

        // Show loading, hide previous results and chart
        loadingDiv.style.display = 'block';
        resultDiv.innerHTML = '';
        resultDiv.classList.remove('show');
        hideChartSection(); // Hide chart while loading

        try {
            // Call YOUR Flask backend quote endpoint
            const response = await fetch(`${BACKEND_URL}/api/stock/${region}/${symbol}`);
            const result = await response.json();

            loadingDiv.style.display = 'none';

            if (result.status === 'success' && result.data) {
                displayStockData(result.data, symbol, region);
            } else {
                displayError(result.message || `Could not fetch data for symbol: ${symbol}. Please check if it's a valid US stock symbol.`);
            }

        } catch (error) {
            loadingDiv.style.display = 'none';
            displayError(`Network Error: Could not connect to the server. Please ensure your Flask backend is running at <strong>${BACKEND_URL}</strong>. <br><br>Error details: ${error.message}`);
            console.error('Fetch error:', error);
        }
    }

    // ==================== DISPLAY STOCK DATA ====================
    function displayStockData(data, symbol, region) {
        const lastPrice = data.ld;
        const change = data.ch;
        const changePercent = data.chp;
        const isPositive = change >= 0;

        // Format volume with commas (e.g., 73,913,425)
        const formattedVolume = data.v ? new Intl.NumberFormat('en-US').format(data.v) : 'N/A';

        const stockCard = `
            <div class="stock-card">
                <div class="stock-header">
                    <div class="symbol-name">
                        <h2>${symbol} <span class="full-name">(${region} Market)</span></h2>
                        <div style="color: #aaa; font-size: 0.9rem; margin-top: 5px;">Live Data via iTick API</div>
                    </div>
                    <div class="price-change">
                        <div class="price">$${lastPrice?.toFixed(2) || 'N/A'}</div>
                        <div class="change ${isPositive ? 'positive' : 'negative'}">
                            ${isPositive ? '+' : ''}${change?.toFixed(2) || 'N/A'} (${isPositive ? '+' : ''}${changePercent?.toFixed(2) || 'N/A'}%)
                        </div>
                    </div>
                </div>
                <div class="stock-details">
                    <div class="detail-box">
                        <div class="detail-label">Open</div>
                        <div class="detail-value">$${data.o?.toFixed(2) || 'N/A'}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">Day's High</div>
                        <div class="detail-value">$${data.h?.toFixed(2) || 'N/A'}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">Day's Low</div>
                        <div class="detail-value">$${data.l?.toFixed(2) || 'N/A'}</div>
                    </div>
                    <div class="detail-box">
                        <div class="detail-label">Volume</div>
                        <div class="detail-value">${formattedVolume}</div>
                    </div>
                </div>
            </div>
        `;

        resultDiv.innerHTML = stockCard;
        setTimeout(() => resultDiv.classList.add('show'), 50);
        
        // After displaying stock data, fetch and show the historical chart
        currentSymbol = symbol;
        fetchAndDisplayHistoricalChart(symbol, 30); // Start with 1 month (30 days)
        setupTimePeriodButtons(symbol); // CRITICAL FIX: Connect buttons to this symbol
	
    	showAIInsightsSection(); // NEW: Show AI section (collapsed)
    	setupAIToggle(); // NEW: Setup the toggle button
    }

    // ==================== HISTORICAL CHART FUNCTIONS ====================
    async function fetchAndDisplayHistoricalChart(symbol, limit = '30') {
        // Reset and highlight the correct time period button
        updateActiveTimePeriodButton(limit);
        
        // 1. CANCEL the previous request if it's still running
        if (currentChartRequestController) {
            currentChartRequestController.abort();
            console.log('Cancelled previous chart request');
        }

        // 2. Create a new AbortController for this request
        currentChartRequestController = new AbortController();
        const signal = currentChartRequestController.signal;

        // Show chart section with loading state
        showChartSection(true);

        try {
            // 3. Pass the signal to the fetch call
            const response = await fetch(`${BACKEND_URL}/api/historical/US/${symbol}?limit=${limit}&kType=8`, { signal });
            const result = await response.json();

            if (result.status === 'success' && result.data) {
                renderStockChart(result.data, symbol, limit);
                showChartSection(false);
            } else {
                showChartSection(false);
                displayChartError(`Could not load historical data for ${symbol}.`);
            }
        } catch (error) {
            // 4. Check if the error is from an abort (this is normal)
            if (error.name === 'AbortError') {
                console.log('Chart fetch was aborted for new request');
                return; // Silently exit, a new request is already running
            }
            console.error('Error fetching historical data:', error);
            showChartSection(false);
            displayChartError(`Error loading chart: ${error.message}`);
        }
    }

    function renderStockChart(historicalData, symbol, limit) {
        // Get the chart container and ensure canvas exists
        const chartContainer = document.querySelector('.chart-container');
        if (!chartContainer) {
            console.error('Chart container not found!');
            return;
        }
        
        // Ensure canvas exists in the container
        let canvas = document.getElementById('stockChart');
        if (!canvas) {
            // Create the canvas element if it doesn't exist
            canvas = document.createElement('canvas');
            canvas.id = 'stockChart';
            chartContainer.innerHTML = ''; // Clear container
            chartContainer.appendChild(canvas);
        }
        
        const ctx = canvas.getContext('2d');
        
        // Destroy previous chart instance if exists
        if (stockChartInstance) {
            stockChartInstance.destroy();
        }
        
        // Prepare data: iTick returns objects with t, o, h, l, c, v.
        // 't' is a Unix timestamp in milliseconds.
        const dates = historicalData.map(item => {
            const date = new Date(item.t);
            // Format based on time period for better readability
            if (limit <= 30) {
                // For short periods, show month/day
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } else if (limit <= 90) {
                // For medium periods, show abbreviated format
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } else {
                // For longer periods, show month/year
                return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            }
        }); 

        const closingPrices = historicalData.map(item => item.c);
        const volumes = historicalData.map(item => item.v);
        
        // Determine line color based on price trend
        const firstPrice = closingPrices[0];
        const lastPrice = closingPrices[closingPrices.length - 1];
        const lineColor = lastPrice >= firstPrice ? 'rgba(0, 200, 83, 0.8)' : 'rgba(244, 67, 54, 0.8)';
        const fillColor = lastPrice >= firstPrice ? 'rgba(0, 200, 83, 0.1)' : 'rgba(244, 67, 54, 0.1)';
        
        // Create the chart
        stockChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: `${symbol} Closing Price`,
                    data: closingPrices,
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    borderWidth: 3,
                    fill: true,
                    tension: 0.1, // Slight curve for better visual
                    pointRadius: 0, // Hide points for cleaner look
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#1d1d1f',
                            font: {
                                size: 14,
                                weight: '600'
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(29, 29, 31, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#0071e3',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                return `$${context.parsed.y.toFixed(2)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(210, 210, 215, 0.3)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#86868b',
                            maxTicksLimit: 10 // Limit number of date labels
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(210, 210, 215, 0.3)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#86868b',
                            callback: function(value) {
                                return '$' + value.toFixed(2);
                            }
                        },
                        title: {
                            display: true,
                            text: 'Price (USD)',
                            color: '#86868b',
                            font: {
                                size: 14,
                                weight: '600'
                            }
                        }
                    }
                },
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart'
                }
            }
        });
    }

    function setupTimePeriodButtons(symbol) {
        const buttons = document.querySelectorAll('.time-period-btn');
        
        // First, remove any existing event listeners by cloning and replacing
        buttons.forEach(button => {
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
        });
        
        // Get the new button references
        const newButtons = document.querySelectorAll('.time-period-btn');
        
        newButtons.forEach(button => {
            button.addEventListener('click', function() {
                const newLimit = this.getAttribute('data-limit');
                fetchAndDisplayHistoricalChart(symbol, newLimit);
            });
        });
    }

    function updateActiveTimePeriodButton(limit) {
        const buttons = document.querySelectorAll('.time-period-btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        
        const activeButton = document.querySelector(`.time-period-btn[data-limit="${limit}"]`);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }

    function showChartSection(isLoading = false) {
        if (!chartSection) return;
        
        chartSection.style.display = 'block';
        
        if (isLoading) {
            // Show loading state in chart container
            const chartContainer = document.querySelector('.chart-container');
            if (chartContainer) {
                chartContainer.innerHTML = `
                    <div style="display: flex; justify-content: center; align-items: center; height: 100%;">
                        <div style="text-align: center;">
                            <div style="width: 50px; height: 50px; border: 3px solid #f5f5f7; border-top: 3px solid #0071e3; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div>
                            <p style="color: #86868b;">Loading historical chart data...</p>
                        </div>
                    </div>
                `;
            }
        } else {
            // Just ensure chart section is visible - don't recreate canvas here
            // The canvas will be created in renderStockChart if needed
        }
    }

    function hideChartSection() {
        if (chartSection) {
            chartSection.style.display = 'none';
        }
        // Destroy chart instance when hiding
        if (stockChartInstance) {
            stockChartInstance.destroy();
            stockChartInstance = null;
        }
        currentSymbol = null;
	hideAIInsightsSection(); //Hide AI section too
    }

    function displayChartError(message) {
        const chartContainer = document.querySelector('.chart-container');
        if (chartContainer) {
            // Clear any existing canvas first
            if (stockChartInstance) {
                stockChartInstance.destroy();
                stockChartInstance = null;
            }
            
            chartContainer.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; height: 100%;">
                    <div style="text-align: center; color: #f44336;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 20px;"></i>
                        <p>${message}</p>
                    </div>
                </div>
            `;
        }
    }

    // ==================== DISPLAY ERROR ====================
    function displayError(message) {
        const errorHtml = `
            <div class="error-box">
                <h3><i class="fas fa-exclamation-triangle"></i> Error</h3>
                <p>${message}</p>
            </div>
        `;
        resultDiv.innerHTML = errorHtml;
        setTimeout(() => resultDiv.classList.add('show'), 50);
        hideChartSection(); // Hide chart when there's an error
    }

    // ==================== LOAD AND DISPLAY MAJOR INDICES ====================
    async function loadMajorIndices() {
        const indicesGrid = document.getElementById('indicesGrid');
        if (!indicesGrid) return;
        
        try {
            const response = await fetch(`${BACKEND_URL}/api/indices`);
            const result = await response.json();
            
            if (result.status === 'success' && result.data) {
                displayIndices(result.data);
            } else {
                showIndicesError();
            }
        } catch (error) {
            console.error('Error loading indices:', error);
            showIndicesError();
        }
    }

    function displayIndices(indicesData) {
        const indicesGrid = document.getElementById('indicesGrid');
        if (!indicesGrid) return;
        
        const indicesHTML = indicesData.map(index => {
            const isPositive = index.change >= 0;
            return `
                <div class="index-card">
                    <div class="index-header">
                        <div class="index-name">${index.name}</div>
                        <div class="index-symbol">${index.symbol}</div>
                    </div>
                    <div class="index-price">$${index.last_price.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    <div class="index-change ${isPositive ? 'positive' : 'negative'}">
                        <i class="fas fa-${isPositive ? 'caret-up' : 'caret-down'}"></i>
                        ${isPositive ? '+' : ''}${index.change.toFixed(2)} (${isPositive ? '+' : ''}${index.change_percent.toFixed(2)}%)
                    </div>
                </div>
            `;
        }).join('');
        
        indicesGrid.innerHTML = indicesHTML;
    }

    function showIndicesError() {
        const indicesGrid = document.getElementById('indicesGrid');
        if (indicesGrid) {
            indicesGrid.innerHTML = `
                <div class="index-card" style="grid-column: 1 / -1; text-align: center; background: #ffeaea;">
                    <i class="fas fa-exclamation-triangle" style="color: #f44336; font-size: 2rem; margin-bottom: 15px;"></i>
                    <div class="index-name">Unable to load market data</div>
                    <p style="color: #666; margin-top: 10px;">Please check your connection and try again.</p>
                </div>
            `;
        }
    }

    // ==================== AUTO-REFRESH INDICES ====================
    // Auto-refresh indices every 120 seconds (120,000 milliseconds)
    setInterval(loadMajorIndices, 120000);

    // Call this when page loads
    loadMajorIndices();

// ==================== AI ANALYSIS FUNCTIONS ====================

function showAIInsightsSection() {
    const aiSection = document.getElementById('aiInsightsSection');
    if (!aiSection) return;
    
    // Show the section (but keep content collapsed)
    aiSection.style.display = 'block';
    
    // Reset to collapsed state
    const aiContent = document.getElementById('aiContent');
    const aiToggleBtn = document.getElementById('aiToggleBtn');
    
    if (aiContent) aiContent.style.display = 'none';
    if (aiToggleBtn) {
        aiToggleBtn.innerHTML = '<span>Show AI Analysis</span><i class="fas fa-chevron-down"></i>';
    }
    
    // DON'T clear analysis data here - we want to keep it cached
    // The data will be cleared in hideAIInsightsSection() when changing stocks
}

function hideAIInsightsSection() {
    const aiSection = document.getElementById('aiInsightsSection');
    if (aiSection) {
        aiSection.style.display = 'none';
    }
    
    // Clear analysis cache when hiding section (changing stocks)
    const aiInsightsGrid = document.getElementById('aiInsightsGrid');
    const aiTechnicalInfo = document.getElementById('aiTechnicalInfo');
    
    if (aiInsightsGrid) {
        aiInsightsGrid.innerHTML = '';
        aiInsightsGrid.style.display = 'none';
    }
    
    if (aiTechnicalInfo) {
        aiTechnicalInfo.innerHTML = '';
        aiTechnicalInfo.style.display = 'none';
    }
}

function setupAIToggle() {
    const aiToggleBtn = document.getElementById('aiToggleBtn');
    const aiContent = document.getElementById('aiContent');
    
    if (!aiToggleBtn || !aiContent) return;
    
    // Remove any existing event listeners (prevent duplicates)
    const newToggleBtn = aiToggleBtn.cloneNode(true);
    aiToggleBtn.parentNode.replaceChild(newToggleBtn, aiToggleBtn);
    
    // Get the new button reference
    const freshToggleBtn = document.getElementById('aiToggleBtn');
    
    freshToggleBtn.addEventListener('click', function() {
        const isExpanded = aiContent.style.display === 'block';
        
        if (isExpanded) {
            // Collapse
            aiContent.style.display = 'none';
            freshToggleBtn.innerHTML = '<span>Show AI Analysis</span><i class="fas fa-chevron-down"></i>';
        } else {
            // Expand
            aiContent.style.display = 'block';
            freshToggleBtn.innerHTML = '<span>Hide Analysis</span><i class="fas fa-chevron-up"></i>';
            
            // Check if we already have analysis for THIS stock
            const hasCurrentAnalysis = checkIfAnalysisExistsForCurrentStock();
            
            if (hasCurrentAnalysis) {
                // Already have analysis, just show it (no API call)
                console.log('Using cached analysis for', currentSymbol);
                showExistingAnalysis();
            } else {
                // Need to fetch fresh analysis
                const loadingAI = document.getElementById('loadingAI');
                if (loadingAI) loadingAI.style.display = 'block';
                
                // Clear any previous content
                document.getElementById('aiInsightsGrid').innerHTML = '';
                document.getElementById('aiInsightsGrid').style.display = 'none';
                document.getElementById('aiTechnicalInfo').innerHTML = '';
                document.getElementById('aiTechnicalInfo').style.display = 'none';
                
                if (currentSymbol) {
                    fetchAIAnalysis(currentSymbol);
                } else {
                    // If no symbol, show error
                    aiContent.innerHTML = `
                        <div class="error-ai">
                            <i class="fas fa-exclamation-triangle"></i>
                            <p>No stock selected. Please search for a stock first.</p>
                        </div>
                    `;
                }
            }
        }
    });
}

// Helper: Check if we already have analysis for the current stock
function checkIfAnalysisExistsForCurrentStock() {
    const aiInsightsGrid = document.getElementById('aiInsightsGrid');
    if (!aiInsightsGrid || !currentSymbol) return false;
    
    // Check if grid has content AND if it's for the current symbol
    const hasContent = aiInsightsGrid.children.length > 0;
    
    // You could add more sophisticated checking here, like
    // storing the symbol with the analysis data
    return hasContent;
}

// Helper: Show existing analysis (already loaded)
function showExistingAnalysis() {
    const loadingAI = document.getElementById('loadingAI');
    const aiInsightsGrid = document.getElementById('aiInsightsGrid');
    const aiTechnicalInfo = document.getElementById('aiTechnicalInfo');
    
    if (loadingAI) loadingAI.style.display = 'none';
    if (aiInsightsGrid) aiInsightsGrid.style.display = 'grid';
    if (aiTechnicalInfo) aiTechnicalInfo.style.display = 'block';
}

async function fetchAIAnalysis(symbol) {
    if (!symbol) return;
    
    const aiContent = document.getElementById('aiContent');
    const loadingAI = document.getElementById('loadingAI');
    const aiInsightsGrid = document.getElementById('aiInsightsGrid');
    const aiTechnicalInfo = document.getElementById('aiTechnicalInfo');
    const region = 'US';
    
    try {
        // Show loading state
        if (loadingAI) loadingAI.style.display = 'block';
        if (aiInsightsGrid) aiInsightsGrid.style.display = 'none';
        if (aiTechnicalInfo) aiTechnicalInfo.style.display = 'none';
        
        const response = await fetch(`${BACKEND_URL}/api/analyze/${region}/${symbol}`);
        const result = await response.json();
        
        if (result.status === 'success') {
            displayAIAnalysis(result);
        } else {
            throw new Error(result.message || 'AI analysis failed');
        }
    } catch (error) {
        console.error('AI Analysis Error:', error);
        if (aiContent) {
            aiContent.innerHTML = `
                <div class="error-ai">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Unable to generate AI analysis. ${error.message}</p>
                    <p style="margin-top: 10px; font-size: 0.9rem;">Please try again in a moment.</p>
                </div>
            `;
        }
    }
}

function displayAIAnalysis(result) {
    const loadingAI = document.getElementById('loadingAI');
    const aiInsightsGrid = document.getElementById('aiInsightsGrid');
    const aiTechnicalInfo = document.getElementById('aiTechnicalInfo');
    const aiAnalysis = result.ai_analysis;
    const techIndicators = result.technical_indicators;
    
    if (!aiAnalysis || !aiInsightsGrid || !aiTechnicalInfo) return;
    
    // Hide loading, show grids
    if (loadingAI) loadingAI.style.display = 'none';
    
    // Create insights grid
    const insightsHTML = `
        <div class="ai-insight-card">
            <div class="ai-insight-icon">
                <i class="fas fa-chart-line"></i>
            </div>
            <h4>Trend Analysis</h4>
            <p>${aiAnalysis.trend_analysis}</p>
        </div>
        
        <div class="ai-insight-card">
            <div class="ai-insight-icon">
                <i class="fas fa-wave-square"></i>
            </div>
            <h4>Volatility Insight</h4>
            <p>${aiAnalysis.volatility_insight}</p>
        </div>
        
        <div class="ai-insight-card">
            <div class="ai-insight-icon">
                <i class="fas fa-shapes"></i>
            </div>
            <h4>Pattern Recognition</h4>
            <p>${aiAnalysis.pattern_recognition}</p>
        </div>
        
        <div class="ai-insight-card">
            <div class="ai-insight-icon">
                <i class="fas fa-newspaper"></i>
            </div>
            <h4>Summary</h4>
            <p>${aiAnalysis.summary}</p>
        </div>
        
        <div class="ai-insight-card">
            <div class="ai-insight-icon">
                <i class="fas fa-exclamation-triangle"></i>
            </div>
            <h4>Risk Commentary</h4>
            <p>${aiAnalysis.risk_commentary}</p>
        </div>
        
        <div class="ai-insight-card">
            <div class="ai-insight-icon">
                <i class="fas fa-eye"></i>
            </div>
            <h4>General Observation</h4>
            <p>${aiAnalysis.general_observation}</p>
        </div>
    `;
    
    aiInsightsGrid.innerHTML = insightsHTML;
    aiInsightsGrid.style.display = 'grid';
    
    // Create technical indicators summary
    const techHTML = `
        <h5><i class="fas fa-info-circle"></i> Technical Indicators Used</h5>
        <div class="tech-indicators-grid">
            <div class="tech-indicator">
                <span class="tech-label">Current Price:</span>
                <span class="tech-value">$${techIndicators.current_price}</span>
            </div>
            <div class="tech-indicator">
                <span class="tech-label">50-Day MA:</span>
                <span class="tech-value">$${techIndicators.moving_average_50}</span>
            </div>
            <div class="tech-indicator">
                <span class="tech-label">RSI:</span>
                <span class="tech-value">${techIndicators.rsi}</span>
            </div>
            <div class="tech-indicator">
                <span class="tech-label">52-Week Range:</span>
                <span class="tech-value">$${techIndicators['52_week_low']} - $${techIndicators['52_week_high']}</span>
            </div>
        </div>
    `;
    
    aiTechnicalInfo.innerHTML = techHTML;
    aiTechnicalInfo.style.display = 'block';
}
}); // END OF DOMContentLoaded