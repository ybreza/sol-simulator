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
        const [tokenResponse, priceResponse] = await Promise.all([
            fetch(`https://tokens.jup.ag/token/${address}`), // Still use Jupiter for metadata
            fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`)
        ]);

        if (!tokenResponse.ok) {
             throw new Error(`Failed to fetch token metadata: ${tokenResponse.statusText}`);
        }
        if (!priceResponse.ok) {
            throw new Error(`Failed to fetch token price: ${priceResponse.statusText}`);
        }

        const tokenData = await tokenResponse.json();
        const priceStr = await priceResponse.text();
        const price = parseFloat(priceStr);

        if (tokenData && tokenData.symbol && !isNaN(price) && price > 0) {
            elements.tokenInfo.style.display = 'block';
            elements.tokenImage.src = tokenData.logoURI || 'placeholder.png'; // Add placeholder if no image
            elements.tokenName.textContent = `${tokenData.name} (${tokenData.symbol})`;
            elements.tokenPrice.textContent = formatPrice(price);

            const shortAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
            document.getElementById('contractDisplay').textContent = shortAddress;

            startPriceUpdates(address);
        } else {
            throw new Error('Invalid token data or price received');
        }
    } catch (error) {
        console.error('Error fetching token data:', error);
        elements.tokenInfo.style.display = 'none';
        // Optionally clear existing token info if fetch fails
         elements.tokenImage.src = '';
         elements.tokenName.textContent = '';
         elements.tokenPrice.textContent = '';
         document.getElementById('contractDisplay').textContent = '';
    }
}

// Add a helper function to format prices appropriately
function formatPrice(price) {
    if (price < 0.000001) { // Use more precision for extremely small numbers
        return price.toExponential(6);
    } else if (price < 0.001) {
        return price.toFixed(8);
    } else if (price < 1) {
        return price.toFixed(6);
    } else if (price < 100) {
        return price.toFixed(4);
    } else {
        return price.toFixed(2);
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
             if (!response.ok) {
                // Don't throw error here, just log it, maybe API is temporarily down
                console.warn(`Failed to update price for ${address}: ${response.statusText}`);
                return; // Skip update if fetch fails
            }
            const priceStr = await response.text();
            const price = parseFloat(priceStr);

            if (!isNaN(price) && price >= 0) { // Allow price to be 0 temporarily
                elements.tokenPrice.textContent = formatPrice(price);
                updatePositionsPNL(address, price);
            } else {
                 console.warn(`Invalid price received for ${address}: ${priceStr}`);
            }
        } catch (error) {
            // Network error or other fetch issue
            console.error(`Error updating price for ${address}:`, error);
            // Consider stopping updates if errors persist?
            // clearInterval(state.priceUpdateIntervals[address]);
            // delete state.priceUpdateIntervals[address];
        }
    };

    updatePrice(); // Initial update
    state.priceUpdateIntervals[address] = setInterval(updatePrice, 3000); // Update every 3 seconds
}


// Update positions PNL
function updatePositionsPNL(address, currentPrice) {
    state.lastPrices[address] = currentPrice;
    let calculatedTotalPnl = 0; // Use a temporary variable

    state.positions.forEach((position, index) => {
        // Only update PNL for the matching address if currentPrice is provided specifically for it
        // Or update all if currentPrice wasn't specific (e.g., during initial load)
         const priceToUse = (address && position.contractAddress === address)
            ? currentPrice
            : (state.lastPrices[position.contractAddress] !== undefined ? state.lastPrices[position.contractAddress] : position.entryPrice);


        let pnl = 0;
        let percentageChange = 0;

        if (priceToUse > 0 && position.entryPrice > 0) { // Avoid division by zero
             pnl = (priceToUse - position.entryPrice) * position.quantity;
             percentageChange = ((priceToUse - position.entryPrice) / position.entryPrice) * 100;
        } else {
            // Handle cases where price might be zero or invalid temporarily
             pnl = (priceToUse - position.entryPrice) * position.quantity; // PNL is still calculable if price is 0
             percentageChange = -100; // Or handle differently if entry price was 0
        }


        const pnlElement = document.getElementById(`pnl-${index}`);
        if (pnlElement) {
            pnlElement.innerHTML = `
                $${pnl.toFixed(2)}
                <span class="${percentageChange >= 0 ? 'profit' : 'loss'}">
                    (${percentageChange >= 0 ? '+' : ''}${percentageChange.toFixed(2)}%)
                </span>
            `;
            pnlElement.className = `stat-value ${pnl >= 0 ? 'profit' : 'loss'}`; // Add stat-value class
        }

        calculatedTotalPnl += pnl;
    });

    state.totalPnl = calculatedTotalPnl; // Update state total PNL

    elements.totalPnl.textContent = state.totalPnl.toFixed(2);
    elements.totalPnlContainer.className = `stat-value ${state.totalPnl >= 0 ? 'profit' : 'loss'}`;
    localStorage.setItem('totalPnl', state.totalPnl.toString()); // Save as string
}


// Buy token with price check
async function buyToken() {
    const amountInput = document.getElementById('tradeAmount');
    const amount = parseFloat(amountInput.value);
    const address = elements.contractInput.value;

    if (!address) {
        alert('Please enter a contract address.');
        return;
    }
     if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid positive trade amount.');
        return;
    }

    if (amount > state.balance) {
        alert('Insufficient balance');
        return;
    }

    try {
        // Get fresh price from API when Buy is clicked
        const response = await fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`);
         if (!response.ok) {
            throw new Error(`Failed to fetch price: ${response.statusText}`);
        }
        const priceStr = await response.text();
        const price = parseFloat(priceStr);

        if (isNaN(price) || price <= 0) {
            alert('Invalid or zero price received from API. Cannot buy.');
            return;
        }

        const quantity = amount / price;
        const newPosition = {
            contractAddress: address,
            symbol: elements.tokenName.textContent.split('(')[1]?.replace(')', '').trim() || 'UNKNOWN', // Safer symbol extraction
            entryPrice: price,
            quantity,
            amount,
            timestamp: new Date().toISOString(),
            tokenImg: elements.tokenImage.src || 'placeholder.png'
        };

        state.balance -= amount;
        state.positions.push(newPosition);

        saveState();
        updateUI();
        startPriceUpdates(address); // Ensure price updates are running for the new position

        // Clear inputs after successful buy
        elements.contractInput.value = '';
        amountInput.value = '';
        elements.tokenInfo.style.display = 'none'; // Hide token info section
         // Stop price updates for the *previous* token if a new one was searched
        // This logic might need refinement depending on desired UX
        Object.keys(state.priceUpdateIntervals).forEach(addr => {
            if (addr !== address) {
                clearInterval(state.priceUpdateIntervals[addr]);
                delete state.priceUpdateIntervals[addr];
            }
        });


    } catch (error) {
        console.error('Error buying token:', error);
        alert(`Error occurred while buying token: ${error.message}. Please try again.`);
    }
}

// Close position
async function closePosition(index) {
    const position = state.positions[index];
    if (!position) return; // Safety check

    try {
        const response = await fetch(`https://data.fluxbeam.xyz/tokens/${position.contractAddress}/price`);
         if (!response.ok) {
            throw new Error(`Failed to fetch closing price: ${response.statusText}`);
        }
        const priceStr = await response.text();
        const currentPrice = parseFloat(priceStr);

        if (!isNaN(currentPrice) && currentPrice >= 0) { // Allow closing at 0 price
            const pnl = (currentPrice - position.entryPrice) * position.quantity;

            // Update balance and history PNL *before* showing card
            const closingValue = position.quantity * currentPrice;
            state.balance += closingValue;
            state.historyTotalPnl += pnl;


            const closedTrade = {
                ...position,
                exitPrice: currentPrice,
                pnl,
                closedAt: new Date().toISOString()
            };
            state.history.push(closedTrade);

            // Remove position and stop its specific price updates
            state.positions.splice(index, 1);
            if (state.priceUpdateIntervals[position.contractAddress]) {
                clearInterval(state.priceUpdateIntervals[position.contractAddress]);
                delete state.priceUpdateIntervals[position.contractAddress];
            }
            delete state.lastPrices[position.contractAddress]; // Remove last known price

             // Recalculate total PNL from remaining positions
             updatePositionsPNL(null, 0); // Pass null address to recalculate all

            // Show PNL Card after state is updated internally but before full UI redraw
            showPnlCard(closedTrade, currentPrice, pnl); // Pass the closed trade object

            localStorage.setItem('historyTotalPnl', state.historyTotalPnl.toString());
            saveState(); // Save updated positions, history, balance
            resetPagination(); // Go back to page 1 of history
            updateUI(); // Update the entire UI

        } else {
             throw new Error('Invalid closing price received from API.');
        }
    } catch (error) {
        console.error('Error closing position:', error);
        alert(`Error closing position: ${error.message}`);
    }
}


// Add closePnlCard to window object so it can be called from HTML
window.closePnlCard = closePnlCard;

// Function to save PNL Card as image
async function savePnlCard() {
    const saveBtn = document.querySelector('.save-image-btn');
    const pnlCard = document.querySelector('.pnl-card');
    if (!saveBtn || !pnlCard) return; // Element check

    // Add loading state
    saveBtn.disabled = true; // Disable button
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; // Use font-awesome spin

    try {
        // Capture the card
        const canvas = await html2canvas(pnlCard, {
            backgroundColor: '#1E293B', // Match card background
            scale: 2, // Higher quality
            useCORS: true, // Important for external images like token icons
            logging: false
        });

        // Create download link
        const link = document.createElement('a');
        const symbol = pnlCard.querySelector('.pnl-title')?.textContent || 'trade';
        link.download = `pnl-card-${symbol}-${Date.now()}.png`; // More descriptive name
        link.href = canvas.toDataURL('image/png');
        link.click();

        // Reset button state after a short delay
         setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-download"></i> Save as Image';
        }, 500);


    } catch (error) {
        console.error('Error saving image:', error);
        alert('Error saving image. Please ensure images loaded correctly and try again.');

        // Reset button state immediately on error
        saveBtn.disabled = false;
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
    const diffSeconds = Math.floor((diffTime % (1000 * 60)) / 1000); // Add seconds for short trades


    let result = '';
    if (diffDays > 0) result += `${diffDays}d `;
    if (diffHours > 0) result += `${diffHours}h `;
    if (diffMinutes > 0) result += `${diffMinutes}m `;
    if (result === '') result = `${diffSeconds}s`; // Show seconds only if less than a minute

    return result.trim(); // Trim trailing space
}


// Function to show PNL Card
function showPnlCard(trade, currentPrice, pnl) { // Accept the full trade object
    const timeHeld = calculateTimeHeld(trade.timestamp, trade.closedAt);
     const percentageChange = trade.entryPrice > 0
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
        : (currentPrice > 0 ? Infinity : 0); // Handle division by zero if entry price was 0


    // Use formatPrice for consistency
    const entryPriceFormatted = formatPrice(trade.entryPrice);
    const exitPriceFormatted = formatPrice(currentPrice);
    const quantityFormatted = trade.quantity.toFixed(6); // More precision for quantity if needed


    const modalHtml = `
        <div class="pnl-modal">
            <div class="pnl-card">
                <button class="pnl-close" onclick="closePnlCard()" aria-label="Close PNL Card">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
                <div class="pnl-header">
                    <div class="pnl-token">
                        <img src="${trade.tokenImg}" alt="${trade.symbol}" onerror="this.src='placeholder.png'; this.onerror=null;">
                        <span class="pnl-title">${trade.symbol}</span>
                    </div>
                    <div class="pnl-amount ${pnl >= 0 ? 'profit' : 'loss'}">
                        ${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}
                    </div>
                     <div class="pnl-percentage ${percentageChange >= 0 ? 'profit' : 'loss'}">
                        (${percentageChange === Infinity ? '∞' : (percentageChange >= 0 ? '+' : '') + percentageChange.toFixed(2)}%)
                    </div>
                </div>
                <div class="pnl-details">
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Entry Price</div>
                        <div class="pnl-detail-value">$${entryPriceFormatted}</div>
                    </div>
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Exit Price</div>
                        <div class="pnl-detail-value">$${exitPriceFormatted}</div>
                    </div>
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Quantity</div>
                        <div class="pnl-detail-value">${quantityFormatted}</div>
                    </div>
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Investment</div>
                        <div class="pnl-detail-value">$${trade.amount.toFixed(2)}</div>
                    </div>
                </div>
                 <div class="time-held pnl-detail-item"> {/* Make it look like other details */}
                    <div class="pnl-detail-label">Time Held</div>
                    <div class="pnl-detail-value">${timeHeld}</div>
                </div>
                <div class="pnl-disclaimer">
                    <p>Generated by <a href="https://simulatorsolana.netlify.app" target="_blank" rel="noopener noreferrer" class="site-link">Solana Paper Trader</a>. Trading involves risk. DYOR.</p>
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
    // Add class with slight delay for transition effect
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
             const modal = document.querySelector('.pnl-modal');
             if (modal) modal.classList.add('show');
        });
    });
}


// Function to close PNL Card
function closePnlCard() {
    const modal = document.querySelector('.pnl-modal');
    if (modal) {
        modal.classList.remove('show');
        // Remove the modal from DOM after transition ends
        modal.addEventListener('transitionend', () => {
            modal.remove();
        }, { once: true });
    }
}


// Save state to localStorage
function saveState() {
    try {
        localStorage.setItem('balance', state.balance.toString());
        localStorage.setItem('positions', JSON.stringify(state.positions));
        localStorage.setItem('history', JSON.stringify(state.history));
        localStorage.setItem('totalPnl', state.totalPnl.toString());
        localStorage.setItem('historyTotalPnl', state.historyTotalPnl.toString()); // Save history PNL too
    } catch (error) {
        console.error("Error saving state to localStorage:", error);
        // Potentially notify user if storage quota is exceeded
        alert("Could not save trading data. LocalStorage might be full.");
    }
}


// Render functions
function renderPositions() {
    elements.activePositions.textContent = state.positions.length;

    if (state.positions.length === 0) {
         elements.openPositions.innerHTML = '<p class="no-data">No open positions.</p>';
         // Ensure total PNL display is reset if no positions
         elements.totalPnl.textContent = '0.00';
         elements.totalPnlContainer.className = 'stat-value'; // Reset class
         state.totalPnl = 0; // Reset state variable
         localStorage.setItem('totalPnl', '0'); // Save reset value
         return;
    }

    elements.openPositions.innerHTML = state.positions.map((position, index) => `
        <div class="position-card">
            <div class="position-header">
                <div class="position-token">
                    <img src="${position.tokenImg}" alt="${position.symbol}" class="token-image" onerror="this.src='placeholder.png'; this.onerror=null;">
                    <h3>${position.symbol}</h3>
                </div>
                <button class="button-close" onclick="closePosition(${index})" aria-label="Close position for ${position.symbol}">Close</button>
            </div>
            <div class="position-stats">
                <div class="stat">
                    <div class="stat-title">Quantity</div>
                    <div class="stat-value">${position.quantity.toFixed(4)}</div>
                </div>
                <div class="stat">
                    <div class="stat-title">Entry Price</div>
                    <div class="stat-value">$${formatPrice(position.entryPrice)}</div>
                </div>
                <div class="stat">
                    <div class="stat-title">Investment</div>
                    <div class="stat-value">$${position.amount.toFixed(2)}</div>
                </div>
                <div class="stat">
                    <div class="stat-title">Current PNL</div>
                    <div class="stat-value neutral" id="pnl-${index}">Calculating...</div> {/* Start neutral */}
                </div>
            </div>
             <div class="position-footer">
                 <small>Opened: ${new Date(position.timestamp).toLocaleString()}</small>
            </div>
        </div>
    `).join('');

    // Immediately update PNL for all existing positions with last known prices or fetch if needed
    updatePositionsPNL(null, 0); // Recalculate all PNL

     // Ensure price updates are running only for currently open positions
    const openAddresses = new Set(state.positions.map(p => p.contractAddress));
    Object.keys(state.priceUpdateIntervals).forEach(addr => {
        if (!openAddresses.has(addr)) {
            clearInterval(state.priceUpdateIntervals[addr]);
            delete state.priceUpdateIntervals[addr];
        }
    });
    // Start updates for any newly added positions that might not have them yet
    state.positions.forEach(position => {
        if (!state.priceUpdateIntervals[position.contractAddress]) {
            startPriceUpdates(position.contractAddress);
        } else {
             // Trigger an immediate PNL update for positions already being tracked
            if (state.lastPrices[position.contractAddress] !== undefined) {
                 updatePositionsPNL(position.contractAddress, state.lastPrices[position.contractAddress]);
             }
        }
    });


}

// Export to CSV function (Improved)
function exportToExcel() { // Keep name for consistency, but it generates CSV
    if (state.history.length === 0) {
        alert("No trade history to export.");
        return;
    }

    // Create CSV header
    const header = ['Symbol', 'Entry Date', 'Entry Time', 'Exit Date', 'Exit Time', 'Time Held (Minutes)', 'Entry Price ($)', 'Exit Price ($)', 'Quantity', 'Investment ($)', 'PNL ($)', 'PNL (%)', 'Contract Address'];
    let csvContent = header.join(',') + '\n';

    // Sort history by closing date (newest first) for export consistency
    const sortedHistory = [...state.history].sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));


    sortedHistory.forEach(trade => {
         const entryDate = new Date(trade.timestamp);
         const exitDate = new Date(trade.closedAt);
         const timeHeldMs = Math.abs(exitDate - entryDate);
         const timeHeldMinutes = (timeHeldMs / (1000 * 60)).toFixed(2);
         const pnlPercent = trade.entryPrice > 0 ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(2) : 'N/A';


         const row = [
            `"${trade.symbol.replace(/"/g, '""')}"`, // Handle commas/quotes in symbol
            entryDate.toLocaleDateString(),
            entryDate.toLocaleTimeString(),
            exitDate.toLocaleDateString(),
            exitDate.toLocaleTimeString(),
            timeHeldMinutes,
            trade.entryPrice.toFixed(8), // Use more precision for prices in export
            trade.exitPrice.toFixed(8),
            trade.quantity.toFixed(8), // Use more precision for quantity
            trade.amount.toFixed(2),
            trade.pnl.toFixed(2),
            pnlPercent,
            `"${trade.contractAddress}"` // Enclose address in quotes
        ];
        csvContent += row.join(',') + '\n';
    });

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
     const formattedDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    link.setAttribute('download', `trade_history_${formattedDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url); // Clean up blob URL
}


// Event listeners for pagination
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

document.getElementById('exportExcel').addEventListener('click', exportToExcel); // Keep ID same

function renderHistory() {
    const pageData = getCurrentPageData();
     const historyContainer = elements.tradeHistory;

    if (state.history.length === 0) {
         historyContainer.innerHTML = '<p class="no-data">No trade history yet.</p>';
         // Ensure history PNL display is reset
         const historyTotalPnlElement = document.getElementById('historyTotalPnl');
         if (historyTotalPnlElement) {
             historyTotalPnlElement.textContent = '$0.00';
             historyTotalPnlElement.className = 'value neutral'; // Reset class
         }

    } else {
         historyContainer.innerHTML = pageData.map(trade => {
            const pnlClass = trade.pnl >= 0 ? 'profit' : 'loss';
            const entryPriceFormatted = formatPrice(trade.entryPrice);
            const exitPriceFormatted = formatPrice(trade.exitPrice);
            const pnlFormatted = `${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}`;

            return `
                <div class="history-item">
                    <div class="history-token">
                        <img src="${trade.tokenImg}" alt="${trade.symbol}" class="token-image" onerror="this.src='placeholder.png'; this.onerror=null;">
                        <div>
                            <h4>${trade.symbol}</h4>
                            <small>Closed: ${new Date(trade.closedAt).toLocaleString()}</small>
                        </div>
                    </div>
                    <div class="trade-info">
                        <div class="pnl-value ${pnlClass}">
                            ${pnlFormatted}
                        </div>
                        <div class="price-details">
                            Entry: $${entryPriceFormatted} <i class="fas fa-arrow-right"></i> Exit: $${exitPriceFormatted}
                        </div>
                         <div class="trade-amount-info">
                            <small>Invested: $${trade.amount.toFixed(2)}</small>
                        </div>
                    </div>
                </div>
            `;
         }).join('');
    }

    updatePaginationControls();

    // Update total history PNL display
    const historyTotalPnlElement = document.getElementById('historyTotalPnl');
    if (historyTotalPnlElement) {
         historyTotalPnlElement.textContent = `$${state.historyTotalPnl.toFixed(2)}`;
         historyTotalPnlElement.className = `value ${state.historyTotalPnl >= 0 ? 'profit' : 'loss'}`;
    }

}


function clearContract() {
    const contractInput = document.getElementById('contractAddress');
    const tradeAmountInput = document.getElementById('tradeAmount');

    if(contractInput) contractInput.value = '';
    if(tradeAmountInput) tradeAmountInput.value = '';

    // Hide token info display
     elements.tokenInfo.style.display = 'none';
     elements.tokenImage.src = '';
     elements.tokenName.textContent = '';
     elements.tokenPrice.textContent = '';
     document.getElementById('contractDisplay').textContent = '';


    // Optionally stop price updates if a token was being watched
    // cleanup(); // Calling full cleanup might be too much, just clear intervals?
    // Or stop the specific interval if tracked? Depends on UX.
    // For now, just clearing the display. Updates will stop when positions close.
}


// Update UI
function updateUI() {
    elements.balance.textContent = state.balance.toFixed(2);
    // Total PNL for open positions is updated within renderPositions -> updatePositionsPNL

    renderPositions(); // Handles open positions and their PNL display
    renderHistory();   // Handles trade history display and pagination

    // History Total PNL is updated within renderHistory
}

// Reset pagination when history changes significantly (e.g., closing a trade)
function resetPagination() {
    state.currentPage = 1;
}

// Cleanup function to stop all price updates
function cleanup() {
    Object.values(state.priceUpdateIntervals).forEach(intervalId => clearInterval(intervalId));
    state.priceUpdateIntervals = {};
    console.log("Price update intervals cleared.");
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    elements.contractInput.addEventListener('input', handleInput);
    document.getElementById('buyButton').addEventListener('click', buyToken);
     document.getElementById('clearContractButton')?.addEventListener('click', clearContract); // Optional clear button


    updateUI(); // Initial render based on loaded state
});


// Event listeners
window.addEventListener('beforeunload', cleanup);

// Add savePnlCard to window object so it can be called from HTML
window.savePnlCard = savePnlCard;

// Global error handling (optional but good practice)
window.addEventListener('error', (event) => {
    console.error('Unhandled error:', event.message, event.filename, event.lineno);
    // Potentially log this error to a monitoring service
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    // Potentially log this error
});
