// State management
let state = {
    balance: parseFloat(localStorage.getItem('balance')) || 100,
    positions: JSON.parse(localStorage.getItem('positions')) || [],
    history: JSON.parse(localStorage.getItem('history')) || [],
    totalPnl: parseFloat(localStorage.getItem('totalPnl')) || 0,
    priceUpdateIntervals: {},
    lastPrices: {},
    currentPage: 1,
    itemsPerPage: 5
};

state.historyTotalPnl = parseFloat(localStorage.getItem('historyTotalPnl')) || 0;

// Pagination and Export functions
function getTotalPages() {
    return Math.ceil(state.history.length / state.itemsPerPage);
}

function getCurrentPageData() {
    const sortedHistory = [...state.history].sort((a, b) => {
        return new Date(b.closedAt) - new Date(a.closedAt);
    });
    
    const startIndex = (state.currentPage - 1) * state.itemsPerPage;
    const endIndex = startIndex + state.itemsPerPage;
    return sortedHistory.slice(startIndex, endIndex);
}

function updatePaginationControls() {
    const totalPages = getTotalPages();
    document.getElementById('pageInfo').textContent = `Page ${state.currentPage} of ${totalPages}`;
    document.getElementById('prevPage').disabled = state.currentPage === 1;
    document.getElementById('nextPage').disabled = state.currentPage === totalPages;
}

// DOM Elements
const elements = {
    balance: document.getElementById('balance'),
    totalPnl: document.getElementById('totalPnl'),
    totalPnlContainer: document.getElementById('totalPnlContainer'),
    activePositions: document.getElementById('activePositions'),
    tokenInfo: document.getElementById('tokenInfo'),
    tokenImage: document.getElementById('tokenImage'),
    tokenName: document.getElementById('tokenName'),
    tokenPrice: document.getElementById('tokenPrice'),
    contractInput: document.getElementById('contractAddress'),
    openPositions: document.getElementById('openPositions'),
    tradeHistory: document.getElementById('tradeHistory')
};

// Debounce function
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// Handle input with debounce
const handleInput = debounce(async (event) => {
    const address = event.target.value.trim();
    if (address.length >= 32) { // Minimum Solana address length
        await fetchTokenInfo(address);
    }
}, 500);

// Fetch token info
async function fetchTokenInfo(address) {
    try {
        // Fetch token metadata from Jupiter as before
        const tokenResponse = await fetch(`https://tokens.jup.ag/token/${address}`);
        const tokenData = await tokenResponse.json();
        
        // Fetch price from Fluxbeam
        const priceResponse = await fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`);
        const priceStr = await priceResponse.text();
        const price = parseFloat(priceStr);

        if (!isNaN(price) && price > 0) {
            elements.tokenInfo.style.display = 'block';
            elements.tokenImage.src = tokenData.logoURI;
            elements.tokenName.textContent = `${tokenData.name} (${tokenData.symbol})`;
            
            // Format price with proper decimal places for small numbers
            elements.tokenPrice.textContent = formatPrice(price);
            
            // Display shortened contract address
            const shortAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
            document.getElementById('contractDisplay').textContent = shortAddress;

            startPriceUpdates(address);
        } else {
            throw new Error('Invalid price received');
        }
    } catch (error) {
        console.error('Error fetching token data:', error);
        elements.tokenInfo.style.display = 'none';
    }
}

// Format prices appropriately
function formatPrice(price) {
    if (price < 0.0001) {
        return price.toExponential(4);
    } else if (price < 1) {
        return price.toFixed(8);
    } else if (price < 10) {
        return price.toFixed(6);
    } else {
        return price.toFixed(4);
    }
}

// Real-time price updates
function startPriceUpdates(address) {
    if (state.priceUpdateIntervals[address]) {
        clearInterval(state.priceUpdateIntervals[address]);
    }

    const updatePrice = async () => {
        try {
            const response = await fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`);
            const priceStr = await response.text();
            const price = parseFloat(priceStr);
            
            if (!isNaN(price) && price > 0) {
                elements.tokenPrice.textContent = formatPrice(price);
                updatePositionsPNL(address, price);
            }
        } catch (error) {
            console.error('Error updating price:', error);
        }
    };

    updatePrice();
    state.priceUpdateIntervals[address] = setInterval(updatePrice, 2000);
}

// Update positions PNL
function updatePositionsPNL(address, currentPrice) {
    state.lastPrices[address] = currentPrice;
    state.totalPnl = state.positions.reduce((total, position) => {
        const positionPrice = state.lastPrices[position.contractAddress] || position.entryPrice;
        const pnl = (positionPrice - position.entryPrice) * position.quantity;
        
        const percentageChange = ((positionPrice - position.entryPrice) / position.entryPrice) * 100;

        const pnlElement = document.getElementById(`pnl-${state.positions.indexOf(position)}`);
        if (pnlElement) {
            pnlElement.innerHTML = `
                $${pnl.toFixed(2)} 
                <span class="${percentageChange >= 0 ? 'profit' : 'loss'}">
                    (${percentageChange >= 0 ? '+' : ''}${percentageChange.toFixed(2)}%)
                </span>
            `;
            pnlElement.className = pnl >= 0 ? 'profit' : 'loss';
        }
        
        return total + pnl;
    }, 0);

    elements.totalPnl.textContent = state.totalPnl.toFixed(2);
    elements.totalPnlContainer.className = `stat-value ${state.totalPnl >= 0 ? 'profit' : 'loss'}`;  
    localStorage.setItem('totalPnl', state.totalPnl);
}

// Buy token with price check
async function buyToken() {
    const amount = parseFloat(document.getElementById('tradeAmount').value);
    const address = elements.contractInput.value;
    
    if (amount > state.balance) {
        alert('Insufficient balance');
        return;
    }

    try {
        // Get fresh price from Fluxbeam API when Buy is clicked
        const response = await fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`);
        const priceStr = await response.text();
        const price = parseFloat(priceStr);

        if (!price || isNaN(price) || price <= 0) {
            alert('Invalid price received from API');
            return;
        }

        const quantity = amount / price;
        const newPosition = {
            contractAddress: address,
            symbol: elements.tokenName.textContent.split('(')[1].replace(')', ''),
            entryPrice: price,
            quantity,
            amount,
            timestamp: new Date().toISOString(),
            tokenImg: elements.tokenImage.src
        };

        state.balance -= amount;
        state.positions.push(newPosition);
        
        saveState();
        updateUI();

        // Update displayed price after purchase
        elements.tokenPrice.textContent = price.toFixed(4);
    } catch (error) {
        console.error('Error buying token:', error);
        alert('Error occurred while buying token. Please try again.');
    }
}

// Close position
async function closePosition(index) {
    const position = state.positions[index];
    
    try {
        const response = await fetch(`https://data.fluxbeam.xyz/tokens/${position.contractAddress}/price`);
        const priceStr = await response.text();
        const currentPrice = parseFloat(priceStr);
        
        if (!isNaN(currentPrice) && currentPrice > 0) {
            const pnl = (currentPrice - position.entryPrice) * position.quantity;
            
            // Show PNL Card before updating state
            showPnlCard(position, currentPrice, pnl);

            state.historyTotalPnl += pnl;
            state.balance += position.amount + pnl;

            state.history.push({
                ...position,
                exitPrice: currentPrice,
                pnl,
                closedAt: new Date().toISOString()
            });

            state.positions.splice(index, 1);
            delete state.lastPrices[position.contractAddress];

            updatePositionsPNL(position.contractAddress, currentPrice);

            localStorage.setItem('historyTotalPnl', state.historyTotalPnl);
            saveState();
            updateUI();
        }
    } catch (error) {
        console.error('Error closing position:', error);
        alert('Error closing position');
    }
}

// Add closePnlCard to window object so it can be called from HTML
window.closePnlCard = closePnlCard;

// Function to save PNL Card as image
async function savePnlCard() {
    const saveBtn = document.querySelector('.save-image-btn');
    const pnlCard = document.querySelector('.pnl-card');
    
    // Add loading state
    saveBtn.classList.add('loading');
    saveBtn.innerHTML = '<i class="fas fa-spinner"></i> Saving...';

    try {
        // Capture the card
        const canvas = await html2canvas(pnlCard, {
            backgroundColor: '#1E293B', // Match card background
            scale: 2, // Higher quality
            removeContainer: true,
            logging: false
        });

        // Create download link
        const link = document.createElement('a');
        link.download = `pnl-card-${new Date().getTime()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        // Reset button state
        saveBtn.classList.remove('loading');
        saveBtn.innerHTML = '<i class="fas fa-download"></i> Save as Image';
    } catch (error) {
        console.error('Error saving image:', error);
        alert('Error saving image. Please try again.');
        
        // Reset button state
        saveBtn.classList.remove('loading');
        saveBtn.innerHTML = '<i class="fas fa-download"></i> Save as Image';
    }
}

// Helper function to calculate time held
function calculateTimeHeld(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffDays > 0) {
        return `${diffDays}d ${diffHours}h`;
    } else if (diffHours > 0) {
        return `${diffHours}h ${diffMinutes}m`;
    } else {
        return `${diffMinutes}m`;
    }
}

// Function to show PNL Card
function showPnlCard(position, currentPrice, pnl) {
    const timeHeld = calculateTimeHeld(position.timestamp, new Date().toISOString());
    const percentageChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    const modalHtml = `
        <div class="pnl-modal">
            <div class="pnl-card">
                <button class="pnl-close" onclick="closePnlCard()">
                    <i class="fas fa-times"></i>
                </button>
                <div class="pnl-header">
                    <div class="pnl-token">
                        <img src="${position.tokenImg}" alt="${position.symbol}">
                        <span class="pnl-title">${position.symbol}</span>
                    </div>
                    <div class="pnl-amount ${pnl >= 0 ? 'profit' : 'loss'}">
                        ${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}
                    </div>
                    <div class="pnl-percentage ${pnl >= 0 ? 'profit' : 'loss'}">
                        (${percentageChange >= 0 ? '+' : ''}${percentageChange.toFixed(2)}%)
                    </div>
                </div>
                <div class="pnl-details">
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Entry Price</div>
                        <div class="pnl-detail-value">$${position.entryPrice.toFixed(4)}</div>
                    </div>
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Exit Price</div>
                        <div class="pnl-detail-value">$${currentPrice.toFixed(4)}</div>
                    </div>
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Quantity</div>
                        <div class="pnl-detail-value">${position.quantity.toFixed(4)}</div>
                    </div>
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Investment</div>
                        <div class="pnl-detail-value">$${position.amount.toFixed(2)}</div>
                    </div>
                </div>
                <div class="time-held">
                    <div class="pnl-detail-label">Time Held</div>
                    <div class="pnl-detail-value">${timeHeld}</div>
                </div>
                <div class="pnl-disclaimer">
                    <p>This PNL Card is generated by <a href="https://simulatorsolana.netlify.app" target="_blank" class="site-link">simulatorsolana.netlify.app</a>. Cryptocurrency trading carries high risk. Make sure to study technical and fundamental analysis before engaging in real trading.</p>
                </div>
                <div class="pnl-actions">
                    <button class="save-image-btn" onclick="savePnlCard()">
                        <i class="fas fa-download"></i> Save as Image
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    setTimeout(() => {
        document.querySelector('.pnl-modal').classList.add('show');
    }, 10);
}

// Function to close PNL Card
function closePnlCard() {
    const modal = document.querySelector('.pnl-modal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.remove();
    }, 300);
}

// Save state to localStorage
function saveState() {
    localStorage.setItem('balance', state.balance);
    localStorage.setItem('positions', JSON.stringify(state.positions));
    localStorage.setItem('history', JSON.stringify(state.history));
    localStorage.setItem('totalPnl', state.totalPnl);
}

// Render functions
function renderPositions() {
    elements.activePositions.textContent = state.positions.length;
    
    elements.openPositions.innerHTML = state.positions.map((position, index) => `
        <div class="position-card">
            <div class="position-header">
                <div class="position-token">
                    <img src="${position.tokenImg}" alt="${position.symbol}" class="token-image">
                    <h3>${position.symbol}</h3>
                </div>
                <button onclick="closePosition(${index})">Close</button>
            </div>
            <div class="position-stats">
                <div class="stat">
                    <div class="stat-title">Quantity</div>
                    <div class="stat-value">${position.quantity.toFixed(4)}</div>
                </div>
                <div class="stat">
                    <div class="stat-title">Entry Price</div>
                    <div class="stat-value">$${position.entryPrice.toFixed(4)}</div>
                </div>
                <div class="stat">
                    <div class="stat-title">Investment</div>
                    <div class="stat-value">$${position.amount.toFixed(2)}</div>
                </div>
                <div class="stat">
                    <div class="stat-title">Current PNL</div>
                    <div class="stat-value" id="pnl-${index}">Calculating...</div>
                </div>
            </div>
        </div>
    `).join('');

    // Start real-time updates for all positions
    state.positions.forEach(position => {
        startPriceUpdates(position.contractAddress);
    });
}

// Export to Excel function
function exportToExcel() {
    // Create CSV content
    let csvContent = 'Symbol,Entry Date,Exit Date,Entry Price,Exit Price,Quantity,Investment,PNL\n';
    
    state.history.forEach(trade => {
        const row = [
            trade.symbol,
            new Date(trade.timestamp).toLocaleDateString(),
            new Date(trade.closedAt).toLocaleDateString(),
            trade.entryPrice.toFixed(4),
            trade.exitPrice.toFixed(4),
            trade.quantity.toFixed(4),
            trade.amount.toFixed(2),
            trade.pnl.toFixed(2)
        ];
        csvContent += row.join(',') + '\n';
    });

    // Create download link
    const encodedUri = encodeURI('data:text/csv;charset=utf-8,' + csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `trade_history_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Event listeners
document.getElementById('prevPage').addEventListener('click', () => {
    if (state.currentPage > 1) {
        state.currentPage--;
        renderHistory();
    }
});

document.getElementById('nextPage').addEventListener('click', () => {
    if (state.currentPage < getTotalPages()) {
        state.currentPage++;
        renderHistory();
    }
});

document.getElementById('exportExcel').addEventListener('click', exportToExcel);

function renderHistory() {
    const pageData = getCurrentPageData();
    
    elements.tradeHistory.innerHTML = pageData.map(trade => `
        <div class="history-item">
            <div class="history-token">
                <img src="${trade.tokenImg}" alt="${trade.symbol}" class="token-image">
                <div>
                    <h4>${trade.symbol}</h4>
                    <small>${new Date(trade.closedAt).toLocaleDateString()}</small>
                </div>
            </div>
            <div class="trade-info">
                <div class="${trade.pnl >= 0 ? 'profit' : 'loss'}">
                    ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}
                </div>
                <div class="price-details">
                    $${trade.entryPrice.toFixed(4)} → $${trade.exitPrice.toFixed(4)}
                </div>
            </div>
        </div>
    `).join('');

    updatePaginationControls();
}

function clearContract() {
    document.getElementById('contractAddress').value = '';
    
    if(document.getElementById('tradeAmount')) {
        document.getElementById('tradeAmount').value = '';
    }
    
    cleanup();
}

// Update UI
function updateUI() {
    elements.balance.textContent = state.balance.toFixed(2);
    elements.totalPnl.textContent = state.totalPnl.toFixed(2);
    elements.totalPnlContainer.className = `stat-value ${state.totalPnl >= 0 ? 'profit' : 'loss'}`;
    
    // Update history total PNL
    const historyTotalPnlElement = document.getElementById('historyTotalPnl');
    historyTotalPnlElement.textContent = `$${state.historyTotalPnl.toFixed(2)}`;
    historyTotalPnlElement.className = `value ${state.historyTotalPnl >= 0 ? 'profit' : 'loss'}`;
    
    renderPositions();
    renderHistory();
}

// Add this to any place where history changes (like closePosition)
function resetPagination() {
    state.currentPage = 1;
}

// Cleanup function
function cleanup() {
    Object.values(state.priceUpdateIntervals).forEach(interval => clearInterval(interval));
    state.priceUpdateIntervals = {};
}

// Initialize
updateUI();

// Event listeners
window.addEventListener('beforeunload', cleanup);

// Add savePnlCard to window object so it can be called from HTML
window.savePnlCard = savePnlCard;

// Error handling for failed API calls
window.addEventListener('unhandledrejection', (event) => {
    console.error('Promise rejection:', event.reason);
    // Implement retry logic or user notification here
});
