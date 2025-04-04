--- START OF FILE app.js ---

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

// Fetch token info (Metadata from Jupiter, Price from Fluxbeam)
async function fetchTokenInfo(address) {
    try {
        const [tokenResponse, priceResponse] = await Promise.all([
            fetch(`https://tokens.jup.ag/token/${address}`), // Still use Jupiter for metadata
            fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`) // Use Fluxbeam for price
        ]);

        // Check if responses are ok
        if (!tokenResponse.ok) {
            throw new Error(`Failed to fetch token metadata: ${tokenResponse.statusText}`);
        }
         if (!priceResponse.ok) {
            // Handle common cases like 404 Not Found
            if (priceResponse.status === 404) {
                 throw new Error(`Token price not found on Fluxbeam for address: ${address}`);
            }
            throw new Error(`Failed to fetch token price: ${priceResponse.statusText}`);
        }

        const tokenData = await tokenResponse.json();
        const priceStr = await priceResponse.text(); // Fluxbeam returns plain text price
        const price = parseFloat(priceStr);

        if (tokenData && !isNaN(price) && price > 0) {
            elements.tokenInfo.style.display = 'block';
            elements.tokenImage.src = tokenData.logoURI || 'placeholder.png'; // Add a fallback image if needed
            elements.tokenName.textContent = `${tokenData.name} (${tokenData.symbol})`;

            // Format price with proper decimal places for small numbers
            elements.tokenPrice.textContent = formatPrice(price);

            // Display shortened contract address
            const shortAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
            document.getElementById('contractDisplay').textContent = shortAddress;

            startPriceUpdates(address);
        } else {
             if (!tokenData) console.error('Invalid token metadata received');
             if (isNaN(price) || price <= 0) console.error('Invalid price received:', priceStr);
            throw new Error('Invalid token metadata or price received');
        }
    } catch (error) {
        console.error('Error fetching token data:', error);
        elements.tokenInfo.style.display = 'none';
         // Optionally display an error message to the user
        alert(`Failed to fetch token data: ${error.message}`);
    }
}


// Add a helper function to format prices appropriately
function formatPrice(price) {
    if (price === 0) return '0.00'; // Handle zero price explicitly
    if (price < 0.000001) { // Use exponential for very small numbers
         return price.toExponential(4);
     } else if (price < 0.01) {
        return price.toFixed(8); // More precision for smaller decimals
    } else if (price < 1) {
        return price.toFixed(6);
    } else if (price < 100) {
        return price.toFixed(4);
    } else {
        return price.toFixed(2); // Standard currency format for larger numbers
    }
}

// Real-time price updates using Fluxbeam
function startPriceUpdates(address) {
    if (state.priceUpdateIntervals[address]) {
        clearInterval(state.priceUpdateIntervals[address]);
    }

    const updatePrice = async () => {
        try {
            const response = await fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`);
            if (!response.ok) {
                // Don't stop the interval, just log error for this attempt
                console.error(`Error updating price (${address}): ${response.status} ${response.statusText}`);
                 // Optionally stop updates if error persists or is critical (e.g., 404)
                if (response.status === 404) {
                    console.warn(`Price endpoint not found for ${address}. Stopping updates.`);
                    clearInterval(state.priceUpdateIntervals[address]);
                    delete state.priceUpdateIntervals[address];
                }
                return; // Skip update if fetch failed
            }
            const priceStr = await response.text();
            const price = parseFloat(priceStr);

            if (!isNaN(price) && price >= 0) { // Allow price to be 0
                // Only update DOM if the currently displayed token matches
                if (elements.contractInput.value === address) {
                     elements.tokenPrice.textContent = formatPrice(price);
                }
                updatePositionsPNL(address, price);
            } else {
                 console.error(`Invalid price format received for ${address}:`, priceStr);
            }
        } catch (error) {
            // Network error or other fetch issue
            console.error(`Error during price update fetch (${address}):`, error);
        }
    };

    updatePrice(); // Initial call
    state.priceUpdateIntervals[address] = setInterval(updatePrice, 3000); // Increased interval slightly
}


// Update positions PNL
function updatePositionsPNL(address, currentPrice) {
    state.lastPrices[address] = currentPrice;
    let activeTotalPnl = 0; // Recalculate total PNL for active positions

    state.positions.forEach((position, index) => {
        // Use the latest fetched price for the specific position's contract address
        const positionCurrentPrice = state.lastPrices[position.contractAddress];

        // If we don't have a recent price for *this specific position*, PNL can't be calculated yet.
        // Or if entry price is somehow zero.
        if (positionCurrentPrice === undefined || positionCurrentPrice === null || position.entryPrice === 0) {
             const pnlElement = document.getElementById(`pnl-${index}`);
             if (pnlElement) {
                 pnlElement.textContent = 'Waiting for price...';
                 pnlElement.className = 'stat-value'; // Reset class
             }
            return; // Skip PNL calculation for this position if price is missing or entry price is zero
        }

        const pnl = (positionCurrentPrice - position.entryPrice) * position.quantity;
        const percentageChange = ((positionCurrentPrice - position.entryPrice) / position.entryPrice) * 100;

        const pnlElement = document.getElementById(`pnl-${index}`);
        if (pnlElement) {
            pnlElement.innerHTML = `
                $${pnl.toFixed(2)}
                <span class="${percentageChange >= 0 ? 'profit' : 'loss'}">
                    (${percentageChange >= 0 ? '+' : ''}${percentageChange.toFixed(2)}%)
                </span>
            `;
            pnlElement.className = `stat-value ${pnl >= 0 ? 'profit' : 'loss'}`; // Ensure class includes stat-value
        }

        activeTotalPnl += pnl; // Add to the running total for active positions
    });


    // Update the total PNL display based on the sum of *currently calculated* PNLs
    state.totalPnl = activeTotalPnl;
    elements.totalPnl.textContent = state.totalPnl.toFixed(2);
    elements.totalPnlContainer.className = `stat-value ${state.totalPnl >= 0 ? 'profit' : 'loss'}`;
    // No need to save totalPnl to localStorage here, it's transient for active positions.
    // localStorage.setItem('totalPnl', state.totalPnl); // Removed saving transient PNL
}


// Buy token with price check using Fluxbeam
async function buyToken() {
    const amount = parseFloat(document.getElementById('tradeAmount').value);
    const address = elements.contractInput.value.trim(); // Ensure address is trimmed

     if (!address) {
        alert('Please enter a contract address.');
        return;
    }
     if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount to buy.');
        return;
    }
    if (amount > state.balance) {
        alert('Insufficient balance');
        return;
    }


    try {
        // Get fresh price from Fluxbeam API when Buy is clicked
        const response = await fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`);
         if (!response.ok) {
            throw new Error(`Failed to fetch price for buying: ${response.statusText}`);
        }
        const priceStr = await response.text();
        const price = parseFloat(priceStr);

        if (isNaN(price) || price <= 0) {
            alert('Invalid price received from API. Cannot buy at zero or negative price.');
            return;
        }

        const quantity = amount / price;
        const newPosition = {
            contractAddress: address,
            symbol: elements.tokenName.textContent.split('(')[1]?.replace(')', '') || 'UNKNOWN', // Safer symbol extraction
            entryPrice: price,
            quantity,
            amount,
            timestamp: new Date().toISOString(),
            tokenImg: elements.tokenImage.src
        };

        state.balance -= amount;
        state.positions.push(newPosition);

        // Start price updates if not already started for this new position
        if (!state.priceUpdateIntervals[address]) {
            startPriceUpdates(address);
        }

        saveState(); // Save balance and new position list
        updateUI();

        // Update displayed price after purchase (using the price we just bought at)
        elements.tokenPrice.textContent = formatPrice(price);

        // Clear inputs after successful buy
        document.getElementById('tradeAmount').value = '';
        // Consider if you want to clear the contract address too
        // elements.contractInput.value = '';
        // elements.tokenInfo.style.display = 'none';


    } catch (error) {
        console.error('Error buying token:', error);
        alert(`Error occurred while buying token: ${error.message}. Please try again.`);
    }
}

// Close position using Fluxbeam price
async function closePosition(index) {
    if (index < 0 || index >= state.positions.length) {
        console.error("Invalid index for closing position:", index);
        return; // Prevent errors with invalid index
    }
    const position = state.positions[index];

    try {
        const response = await fetch(`https://data.fluxbeam.xyz/tokens/${position.contractAddress}/price`);
         if (!response.ok) {
            throw new Error(`Failed to fetch closing price: ${response.statusText}`);
        }
        const priceStr = await response.text();
        const currentPrice = parseFloat(priceStr);

        if (!isNaN(currentPrice) && currentPrice >= 0) { // Allow closing at zero price
            const pnl = (currentPrice - position.entryPrice) * position.quantity;

            // Show PNL Card before updating state
            showPnlCard(position, currentPrice, pnl);

            state.historyTotalPnl += pnl;
            state.balance += position.amount + pnl; // Add back original investment + PNL

            state.history.push({
                ...position,
                exitPrice: currentPrice,
                pnl,
                closedAt: new Date().toISOString()
            });

            const closedAddress = position.contractAddress;
            state.positions.splice(index, 1); // Remove position from active list

            // Stop price updates ONLY if no other open positions use this contract address
             const isAddressStillOpen = state.positions.some(p => p.contractAddress === closedAddress);
             if (!isAddressStillOpen && state.priceUpdateIntervals[closedAddress]) {
                clearInterval(state.priceUpdateIntervals[closedAddress]);
                delete state.priceUpdateIntervals[closedAddress];
                delete state.lastPrices[closedAddress]; // Clean up last price for this address
             }


            // Recalculate total active PNL after removing the position
            updatePositionsPNL(null, null); // Pass null to force recalculation based on remaining positions

            localStorage.setItem('historyTotalPnl', state.historyTotalPnl); // Save cumulative history PNL
            saveState(); // Save updated balance, positions, history
            resetPagination(); // Go back to page 1 of history
            updateUI();
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
     const pnlCard = document.querySelector('.pnl-card');
     if (!pnlCard) return; // Exit if card not found

    const saveBtn = pnlCard.querySelector('.save-image-btn');
    if (!saveBtn) return; // Exit if button not found


    // Add loading state
    saveBtn.disabled = true; // Disable button during processing
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; // Use font-awesome spin

    try {
         // Ensure html2canvas is loaded (add script tag to HTML if not already)
         if (typeof html2canvas === 'undefined') {
             console.error('html2canvas library is not loaded.');
             alert('Error: html2canvas library not found. Cannot save image.');
              // Reset button state
             saveBtn.disabled = false;
             saveBtn.innerHTML = '<i class="fas fa-download"></i> Save as Image';
             return;
         }

        // Capture the card
        const canvas = await html2canvas(pnlCard, {
            backgroundColor: '#1E293B', // Match card background (use actual background if different)
            scale: 2, // Higher quality
            useCORS: true, // Important if images are from external sources (like token logos)
            // removeContainer: true, // Sometimes causes issues, test without it first
            logging: false
        });

        // Create download link
        const link = document.createElement('a');
        link.download = `pnl-card-${Date.now()}.png`; // Use timestamp for unique name
        link.href = canvas.toDataURL('image/png');
        link.click();

        // Reset button state after a short delay to ensure download starts
        setTimeout(() => {
             saveBtn.disabled = false;
             saveBtn.innerHTML = '<i class="fas fa-download"></i> Save as Image';
         }, 500);

    } catch (error) {
        console.error('Error saving image:', error);
        alert('Error saving image. Please try again.');

        // Reset button state
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-download"></i> Save as Image';
    }
}


// Helper function to calculate time held
function calculateTimeHeld(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start); // Milliseconds

    const diffSeconds = Math.floor(diffTime / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    const minutesRemainder = diffMinutes % 60;
    const hoursRemainder = diffHours % 24;
    const secondsRemainder = diffSeconds % 60;


    if (diffDays > 0) {
        return `${diffDays}d ${hoursRemainder}h ${minutesRemainder}m`;
    } else if (diffHours > 0) {
        return `${diffHours}h ${minutesRemainder}m ${secondsRemainder}s`;
    } else if (diffMinutes > 0) {
        return `${diffMinutes}m ${secondsRemainder}s`;
    } else {
         return `${diffSeconds}s`; // Show seconds if less than a minute
    }
}

// Function to show PNL Card
function showPnlCard(position, currentPrice, pnl) {
    const timeHeld = calculateTimeHeld(position.timestamp, new Date().toISOString());
    // Handle division by zero if entry price is 0
    const percentageChange = position.entryPrice !== 0
        ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
        : 0; // Or handle as infinite/undefined if appropriate

    const modalHtml = `
        <div class="pnl-modal">
            <div class="pnl-card">
                <button class="pnl-close" onclick="closePnlCard()">
                    <i class="fas fa-times"></i>
                </button>
                <div class="pnl-header">
                    <div class="pnl-token">
                         <img src="${position.tokenImg}" alt="${position.symbol || 'Token'}" onerror="this.src='placeholder.png'; this.onerror=null;"> <!-- Added fallback image -->
                         <span class="pnl-title">${position.symbol || 'Unknown Token'}</span>
                    </div>
                    <div class="pnl-amount ${pnl >= 0 ? 'profit' : 'loss'}">
                        ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} <!-- Removed Math.abs to show sign -->
                    </div>
                    <div class="pnl-percentage ${pnl >= 0 ? 'profit' : 'loss'}">
                        (${percentageChange >= 0 ? '+' : ''}${percentageChange.toFixed(2)}%)
                    </div>
                </div>
                <div class="pnl-details">
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Entry Price</div>
                        <div class="pnl-detail-value">$${formatPrice(position.entryPrice)}</div> <!-- Use formatPrice -->
                    </div>
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Exit Price</div>
                        <div class="pnl-detail-value">$${formatPrice(currentPrice)}</div> <!-- Use formatPrice -->
                    </div>
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Quantity</div>
                         <div class="pnl-detail-value">${position.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div> <!-- Format quantity -->
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
                     <p>PNL Card generated by <a href="https://simulatorsolana.netlify.app" target="_blank" class="site-link">simulatorsolana.netlify.app</a>. Trading involves risk. This is a simulation.</p>
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
    // Force reflow before adding class for transition
    const modalElement = document.querySelector('.pnl-modal');
     if (modalElement) {
         void modalElement.offsetWidth; // Reflow trick
         modalElement.classList.add('show');
     }
}


// Function to close PNL Card
function closePnlCard() {
    const modal = document.querySelector('.pnl-modal');
    if (modal) {
        modal.classList.remove('show');
        // Remove the element after the transition completes
        modal.addEventListener('transitionend', () => {
            modal.remove();
        }, { once: true }); // Ensure listener is removed after firing once
    }
}

// Save state to localStorage
function saveState() {
    try {
        localStorage.setItem('balance', state.balance);
        localStorage.setItem('positions', JSON.stringify(state.positions));
        localStorage.setItem('history', JSON.stringify(state.history));
        localStorage.setItem('historyTotalPnl', state.historyTotalPnl); // Also save history PNL
        // Removed saving transient totalPnl (active positions PNL)
        // localStorage.setItem('totalPnl', state.totalPnl);
    } catch (error) {
        console.error("Error saving state to localStorage:", error);
        // Handle potential storage errors (e.g., quota exceeded)
        alert("Could not save progress. LocalStorage might be full or disabled.");
    }
}


// Render functions
function renderPositions() {
    elements.activePositions.textContent = state.positions.length;

    if (state.positions.length === 0) {
        elements.openPositions.innerHTML = '<p class="no-positions">No open positions.</p>'; // Message when empty
    } else {
        elements.openPositions.innerHTML = state.positions.map((position, index) => `
            <div class="position-card">
                <div class="position-header">
                    <div class="position-token">
                         <img src="${position.tokenImg}" alt="${position.symbol || 'Token'}" class="token-image" onerror="this.src='placeholder.png'; this.onerror=null;"> <!-- Added fallback -->
                         <h3>${position.symbol || 'Unknown Token'}</h3>
                    </div>
                     <button class="close-btn" onclick="closePosition(${index})" title="Close Position"><i class="fas fa-times"></i> Close</button> <!-- Improved button -->
                </div>
                <div class="position-stats">
                    <div class="stat">
                        <div class="stat-title">Quantity</div>
                         <div class="stat-value">${position.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div> <!-- Format quantity -->
                    </div>
                    <div class="stat">
                        <div class="stat-title">Entry Price</div>
                        <div class="stat-value">$${formatPrice(position.entryPrice)}</div> <!-- Use formatPrice -->
                    </div>
                    <div class="stat">
                        <div class="stat-title">Investment</div>
                        <div class="stat-value">$${position.amount.toFixed(2)}</div>
                    </div>
                    <div class="stat">
                        <div class="stat-title">Current PNL</div>
                         <div class="stat-value pnl-placeholder" id="pnl-${index}">Calculating...</div> <!-- Added placeholder class -->
                    </div>
                </div>
            </div>
        `).join('');
    }

    // Start/Ensure real-time updates for all currently open positions
    // This also handles cases where the page was reloaded with existing positions
    state.positions.forEach(position => {
        if (!state.priceUpdateIntervals[position.contractAddress]) {
             startPriceUpdates(position.contractAddress);
         } else {
             // If interval exists, trigger an immediate PNL update in case price was missed
             if (state.lastPrices[position.contractAddress] !== undefined) {
                 updatePositionsPNL(position.contractAddress, state.lastPrices[position.contractAddress]);
             }
         }
    });
}


// Export to Excel function (generates CSV)
function exportToExcel() {
     if (state.history.length === 0) {
        alert("No trade history to export.");
        return;
    }

    // Create CSV header
    const header = ['Symbol', 'Entry Date', 'Entry Time', 'Exit Date', 'Exit Time', 'Entry Price', 'Exit Price', 'Quantity', 'Investment', 'PNL ($)', 'PNL (%)', 'Time Held'];
    let csvContent = header.join(',') + '\n';

    // Add data rows (sorted by closed date descending, matching the display)
    const sortedHistory = [...state.history].sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

    sortedHistory.forEach(trade => {
        const entryDate = new Date(trade.timestamp);
        const exitDate = new Date(trade.closedAt);
        const percentageChange = trade.entryPrice !== 0
            ? (((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2)
            : 'N/A';
        const timeHeld = calculateTimeHeld(trade.timestamp, trade.closedAt);

        const row = [
            `"${trade.symbol || 'Unknown'}"`, // Enclose symbol in quotes in case it has commas
            entryDate.toLocaleDateString(),
            entryDate.toLocaleTimeString(),
            exitDate.toLocaleDateString(),
            exitDate.toLocaleTimeString(),
            trade.entryPrice.toFixed(8), // Use more precision for prices in CSV
            trade.exitPrice.toFixed(8),
            trade.quantity.toFixed(8),
            trade.amount.toFixed(2),
            trade.pnl.toFixed(2),
            percentageChange,
            `"${timeHeld}"` // Enclose time held in quotes
        ];
        csvContent += row.join(',') + '\n';
    });


    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    link.setAttribute('download', `trade_history_${timestamp}.csv`);
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
        updatePaginationControls(); // Update controls after rendering
    }
});

document.getElementById('nextPage').addEventListener('click', () => {
    if (state.currentPage < getTotalPages()) {
        state.currentPage++;
        renderHistory();
        updatePaginationControls(); // Update controls after rendering
    }
});

// Listener for export button
document.getElementById('exportExcel').addEventListener('click', exportToExcel);

// Listener for contract input
elements.contractInput.addEventListener('input', handleInput);

// Listener for buy button
document.getElementById('buyButton').addEventListener('click', buyToken); // Ensure button has id="buyButton"

// Listener for clear button (assuming one exists or is added)
const clearButton = document.getElementById('clearContractButton'); // Needs a button with this ID in HTML
if (clearButton) {
    clearButton.addEventListener('click', clearContract);
}


function renderHistory() {
    const pageData = getCurrentPageData();

    if (pageData.length === 0 && state.history.length > 0) {
        // Handle case where current page might be invalid after deleting items
        state.currentPage = Math.max(1, getTotalPages());
         renderHistory(); // Re-render with corrected page
         return;
     }

    if (pageData.length === 0) {
        elements.tradeHistory.innerHTML = '<p class="no-history">No trade history yet.</p>';
    } else {
        elements.tradeHistory.innerHTML = pageData.map(trade => {
             const pnlClass = trade.pnl >= 0 ? 'profit' : 'loss';
             const exitPrice = trade.exitPrice !== undefined && trade.exitPrice !== null ? formatPrice(trade.exitPrice) : 'N/A';
             const entryPrice = formatPrice(trade.entryPrice);
             const closeDate = new Date(trade.closedAt);

            return `
                <div class="history-item">
                    <div class="history-token">
                        <img src="${trade.tokenImg}" alt="${trade.symbol || 'Token'}" class="token-image" onerror="this.src='placeholder.png'; this.onerror=null;">
                        <div>
                            <h4>${trade.symbol || 'Unknown'}</h4>
                             <small>${closeDate.toLocaleDateString()} ${closeDate.toLocaleTimeString()}</small> <!-- Show date and time -->
                        </div>
                    </div>
                    <div class="trade-info">
                        <div class="${pnlClass}">
                            ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}
                        </div>
                        <div class="price-details" title="Entry Price → Exit Price">
                            $${entryPrice} → $${exitPrice}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updatePaginationControls(); // Ensure controls are updated whenever history renders
}

// Function to clear contract input and related info
function clearContract() {
     elements.contractInput.value = '';
    const tradeAmountInput = document.getElementById('tradeAmount');
     if (tradeAmountInput) {
        tradeAmountInput.value = '';
    }
    elements.tokenInfo.style.display = 'none'; // Hide token info section
    elements.tokenImage.src = ''; // Clear image
    elements.tokenName.textContent = '';
    elements.tokenPrice.textContent = '';
    document.getElementById('contractDisplay').textContent = ''; // Clear short address display

    // Optionally stop price updates if the cleared address was the one being updated
    // However, startPriceUpdates already clears previous intervals, so this might not be strictly necessary
    // unless you want to explicitly stop the *last* one when clearing.
    // cleanup(); // Reconsider if cleanup is needed here - might stop updates for positions
}


// Update UI - Consolidates all rendering calls
function updateUI() {
    elements.balance.textContent = state.balance.toFixed(2);

    // Update Active PNL display (calculated in updatePositionsPNL)
    elements.totalPnl.textContent = state.totalPnl.toFixed(2);
    elements.totalPnlContainer.className = `stat-value ${state.totalPnl >= 0 ? 'profit' : 'loss'}`;

    // Update history total PNL display
    const historyTotalPnlElement = document.getElementById('historyTotalPnl');
     if (historyTotalPnlElement) {
        historyTotalPnlElement.textContent = `$${state.historyTotalPnl.toFixed(2)}`;
        historyTotalPnlElement.className = `value ${state.historyTotalPnl >= 0 ? 'profit' : 'loss'}`;
    }

    renderPositions(); // Renders open positions and triggers PNL calculation/updates
    renderHistory(); // Renders trade history page
    // updatePaginationControls(); // Called within renderHistory
}

// Reset pagination to first page, typically after an action that changes history
function resetPagination() {
    state.currentPage = 1;
}

// Cleanup function - Stop all price update intervals
function cleanup() {
    console.log("Cleaning up price update intervals...");
    Object.values(state.priceUpdateIntervals).forEach(intervalId => clearInterval(intervalId));
    state.priceUpdateIntervals = {};
    state.lastPrices = {}; // Clear last known prices
}

// Initialize the application
function initialize() {
    console.log("Initializing Simulator...");
    updateUI(); // Initial render based on loaded state
     // Add event listeners not already added
     window.addEventListener('beforeunload', cleanup); // Cleanup intervals on page close/refresh

     // Global error handlers
     window.addEventListener('unhandledrejection', (event) => {
         console.error('Unhandled Promise Rejection:', event.reason);
         // alert(`An unexpected error occurred: ${event.reason?.message || event.reason}`);
     });
     window.addEventListener('error', (event) => {
         console.error('Uncaught Error:', event.error);
         // alert(`An critical error occurred: ${event.error?.message || 'Unknown error'}`);
     });
 }

// Start the app
initialize();

// Expose functions to global scope if needed for inline HTML handlers (like closePosition, savePnlCard)
window.closePosition = closePosition;
window.savePnlCard = savePnlCard; // Already done, but good practice to keep together

--- END OF FILE app.js ---