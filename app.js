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
    // Sort history by closedAt date descending
    const sortedHistory = [...state.history].sort((a, b) => {
        // Handle cases where closedAt might be missing or invalid temporarily
        const dateA = a.closedAt ? new Date(a.closedAt) : new Date(0);
        const dateB = b.closedAt ? new Date(b.closedAt) : new Date(0);
        return dateB - dateA;
    });

    const startIndex = (state.currentPage - 1) * state.itemsPerPage;
    const endIndex = startIndex + state.itemsPerPage;
    return sortedHistory.slice(startIndex, endIndex);
}


function updatePaginationControls() {
    const totalPages = getTotalPages();
    // Ensure totalPages is at least 1
    const displayTotalPages = Math.max(totalPages, 1);
    document.getElementById('pageInfo').textContent = `Page ${state.currentPage} of ${displayTotalPages}`;
    document.getElementById('prevPage').disabled = state.currentPage === 1;
    document.getElementById('nextPage').disabled = state.currentPage === displayTotalPages; // Use displayTotalPages
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
    } else {
         elements.tokenInfo.style.display = 'none'; // Sembunyikan info token jika address tidak valid
         // Hentikan update harga jika ada interval yang berjalan untuk address lama (jika dihapus)
         clearPriceUpdateForAddress(address); // Anda mungkin perlu fungsi ini
    }
}, 500);

// *** UPDATED FUNCTION ***
// Fetch token info (Metadata from Jupiter, Price from Fluxbeam)
async function fetchTokenInfo(address) {
    try {
        // Fetch token metadata (name, symbol, image) - still using Jupiter for this
        const tokenResponse = await fetch(`https://tokens.jup.ag/token/${address}`);
        if (!tokenResponse.ok) {
             // Handle cases where token metadata is not found
             console.error(`Token metadata not found for ${address}. Status: ${tokenResponse.status}`);
             elements.tokenInfo.style.display = 'none';
             return; // Stop execution if metadata fails
        }
        const tokenData = await tokenResponse.json();

        // Fetch price from Fluxbeam
        const priceResponse = await fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`);
        if (!priceResponse.ok) {
            throw new Error(`Fluxbeam price fetch failed with status ${priceResponse.status}`);
        }
        // Fluxbeam returns the price directly as text
        const priceStr = await priceResponse.text();
        const price = parseFloat(priceStr);

        if (tokenData && tokenData.symbol && !isNaN(price) && price > 0) {
            elements.tokenInfo.style.display = 'block';
            elements.tokenImage.src = tokenData.logoURI || 'placeholder.png'; // Fallback image
            elements.tokenName.textContent = `${tokenData.name || 'Unknown'} (${tokenData.symbol})`;

            // Format price with proper decimal places for small numbers
            elements.tokenPrice.textContent = formatPrice(price);

            // Display shortened contract address
            const shortAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
            document.getElementById('contractDisplay').textContent = shortAddress;
             document.getElementById('contractDisplay').title = address; // Show full address on hover


            startPriceUpdates(address); // Start price updates using Fluxbeam
        } else {
            console.error('Invalid price or token data received', { price, tokenData });
            throw new Error('Invalid price or token data received');
        }
    } catch (error) {
        console.error('Error fetching token data:', error);
        elements.tokenInfo.style.display = 'none';
         // Optionally display an error message to the user in the UI
         // document.getElementById('fetchErrorDisplay').textContent = `Error fetching data for ${address}. Please check the contract address.`;
    }
}


// Add a helper function to format prices appropriately
function formatPrice(price) {
    if (price === 0) return '0.00'; // Handle zero price specifically
    if (price < 0.000001) { // Use exponential for very small numbers
        return price.toExponential(4);
    } else if (price < 0.01) {
        return price.toFixed(8); // More precision for prices under 1 cent
    } else if (price < 1) {
        return price.toFixed(6); // Good precision for typical altcoins
    } else if (price < 100) {
        return price.toFixed(4); // Standard precision
    } else {
        return price.toFixed(2); // For higher value tokens, 2 decimal places are usually enough
    }
}

// *** UPDATED FUNCTION ***
// Real-time price updates using Fluxbeam
function startPriceUpdates(address) {
    // Clear existing interval for this address *before* starting a new one
    clearPriceUpdateForAddress(address);

    const updatePrice = async () => {
        // Check if the contract address input still matches the address we are updating
        // This prevents updates for a token that is no longer displayed
        if (elements.contractInput.value.trim() !== address && !state.positions.some(p => p.contractAddress === address)) {
             clearPriceUpdateForAddress(address);
             console.log(`Stopping updates for ${address} as it's no longer the active token or in positions.`);
             return;
        }

        try {
            const response = await fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`);
             if (!response.ok) {
                 // Don't throw error here, just log it, maybe the next try will succeed
                 console.error(`Fluxbeam price update failed for ${address}. Status: ${response.status}`);
                 // Optionally, display a temporary error state in the price field?
                 // elements.tokenPrice.textContent = 'Update Error';
                 return; // Skip updating PNL if fetch failed
             }
            const priceStr = await response.text();
            const price = parseFloat(priceStr);

            if (!isNaN(price) && price >= 0) { // Allow price to be 0
                // Only update the main display if this address matches the input field
                if (elements.contractInput.value.trim() === address) {
                    elements.tokenPrice.textContent = formatPrice(price);
                }
                updatePositionsPNL(address, price); // Update PNL for all relevant positions
            } else {
                 console.warn(`Received invalid price data from Fluxbeam for ${address}: ${priceStr}`);
            }
        } catch (error) {
            console.error('Error updating price:', error);
            // Consider stopping updates if it fails repeatedly?
            // clearPriceUpdateForAddress(address);
        }
    };

    updatePrice(); // Initial call
    state.priceUpdateIntervals[address] = setInterval(updatePrice, 3000); // Increased interval slightly
}

// Helper to clear a specific price update interval
function clearPriceUpdateForAddress(address) {
     if (state.priceUpdateIntervals[address]) {
        clearInterval(state.priceUpdateIntervals[address]);
        delete state.priceUpdateIntervals[address];
        console.log(`Cleared price update interval for ${address}`);
    }
}


// Update positions PNL
function updatePositionsPNL(address, currentPrice) {
    state.lastPrices[address] = currentPrice;
    let activeTotalPnl = 0; // Recalculate total PNL from active positions

    state.positions.forEach((position, index) => {
        // Use the latest price if available for the specific position's address, otherwise use entry (shouldn't happen if updates are working)
        const positionCurrentPrice = state.lastPrices[position.contractAddress] || position.entryPrice;

        // Check if the current update matches the position's address OR if we need to update all
        // This calculation should happen for *every* position when *any* price updates, using the latest stored price for *each* position.
        const pnl = (positionCurrentPrice - position.entryPrice) * position.quantity;

        let percentageChange = 0;
        if (position.entryPrice !== 0) { // Avoid division by zero
            percentageChange = ((positionCurrentPrice - position.entryPrice) / position.entryPrice) * 100;
        } else if (positionCurrentPrice > 0) {
             percentageChange = Infinity; // Or handle as a large number/special case
        }


        const pnlElement = document.getElementById(`pnl-${index}`);
        if (pnlElement) {
            pnlElement.innerHTML = `
                $${pnl.toFixed(2)}
                <span class="${percentageChange >= 0 ? 'profit' : 'loss'}">
                    (${percentageChange === Infinity ? '∞' : (percentageChange >= 0 ? '+' : '') + percentageChange.toFixed(2)}%)
                </span>
            `;
            // Ensure class reflects PNL sign, handle zero case neutrally or as profit
            pnlElement.className = `stat-value ${pnl >= 0 ? 'profit' : 'loss'}`;
        }

        activeTotalPnl += pnl; // Add this position's PNL to the running total
    });

    state.totalPnl = activeTotalPnl; // Update the state's total PNL

    elements.totalPnl.textContent = state.totalPnl.toFixed(2);
    elements.totalPnlContainer.className = `stat-value ${state.totalPnl >= 0 ? 'profit' : 'loss'}`;
    localStorage.setItem('totalPnl', state.totalPnl.toString()); // Save updated PNL
}


// *** UPDATED FUNCTION ***
// Buy token with price check using Fluxbeam
async function buyToken() {
    const amountInput = document.getElementById('tradeAmount');
    const amount = parseFloat(amountInput.value);
    const address = elements.contractInput.value.trim(); // Ensure address is trimmed

     // --- Input Validations ---
    if (!address || address.length < 32) {
        alert('Please enter a valid Solana contract address.');
        return;
    }
     if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid positive trade amount.');
        return;
    }
    if (amount > state.balance) {
        alert('Insufficient balance.');
        return;
    }
     // --- End Validations ---


    try {
        // Get fresh price from Fluxbeam API when Buy is clicked
        const response = await fetch(`https://data.fluxbeam.xyz/tokens/${address}/price`);
        if (!response.ok) {
            throw new Error(`Fluxbeam price fetch failed before buy. Status: ${response.status}`);
        }
        const priceStr = await response.text();
        const price = parseFloat(priceStr);

        if (isNaN(price) || price <= 0) {
            // Check if the token info is displayed - maybe the fetch failed earlier
             if (elements.tokenInfo.style.display === 'none') {
                  alert('Cannot buy. Token information not loaded or invalid. Please check the contract address.');
             } else {
                 alert('Invalid price received from API. Cannot execute trade.');
             }
            return;
        }

        const quantity = amount / price;
        // Ensure token details are available from the UI elements (fetched previously)
        const tokenNameElement = elements.tokenName; // Use the cached element
        const tokenImageElement = elements.tokenImage; // Use the cached element
        if (!tokenNameElement || !tokenNameElement.textContent || !tokenImageElement || !tokenImageElement.src) {
             alert('Token details are missing. Please wait for the token info to load or try re-entering the address.');
             return;
        }
        const symbolMatch = tokenNameElement.textContent.match(/\(([^)]+)\)/); // Extract symbol like (SOL) -> SOL
         const symbol = symbolMatch ? symbolMatch[1] : 'UNKNOWN'; // Fallback symbol


        const newPosition = {
            contractAddress: address,
            symbol: symbol,
            entryPrice: price,
            quantity,
            amount,
            timestamp: new Date().toISOString(),
            tokenImg: tokenImageElement.src
        };

        state.balance -= amount;
        state.positions.push(newPosition);

        saveState();
        updateUI(); // This will re-render positions and call startPriceUpdates if needed

        // Clear the amount input after successful buy
        amountInput.value = '';

        // Update displayed price just in case it wasn't updated recently
        elements.tokenPrice.textContent = formatPrice(price);

        // Start price updates for the newly added position if not already running
        startPriceUpdates(address);

    } catch (error) {
        console.error('Error buying token:', error);
        alert(`Error occurred while buying token: ${error.message}. Please try again.`);
    }
}

// *** UPDATED FUNCTION ***
// Close position using Fluxbeam price
async function closePosition(index) {
    if (index < 0 || index >= state.positions.length) {
        console.error("Invalid index for closing position:", index);
        return;
    }
    const position = state.positions[index];

    try {
        // Get current price from Fluxbeam
        const response = await fetch(`https://data.fluxbeam.xyz/tokens/${position.contractAddress}/price`);
        if (!response.ok) {
            throw new Error(`Fluxbeam price fetch failed before close. Status: ${response.status}`);
        }
        const priceStr = await response.text();
        const currentPrice = parseFloat(priceStr);

        if (!isNaN(currentPrice) && currentPrice >= 0) { // Allow closing at 0 price
            const pnl = (currentPrice - position.entryPrice) * position.quantity;

            // Show PNL Card *before* updating state and UI fully
            showPnlCard(position, currentPrice, pnl);

            // Update state *after* showing the card (or handle async if needed)
            state.historyTotalPnl += pnl;
            state.balance += position.amount + pnl; // Return initial investment + PNL

            state.history.push({
                ...position,
                exitPrice: currentPrice,
                pnl,
                closedAt: new Date().toISOString()
            });

            const closedContractAddress = position.contractAddress;
            state.positions.splice(index, 1); // Remove position from active list

             // Stop price updates for this token *only if* it's not the currently viewed token
             // and no other open positions exist for it.
             const isTokenStillDisplayed = elements.contractInput.value.trim() === closedContractAddress;
             const hasOtherPositions = state.positions.some(p => p.contractAddress === closedContractAddress);
             if (!isTokenStillDisplayed && !hasOtherPositions) {
                 clearPriceUpdateForAddress(closedContractAddress);
             }


            // Recalculate total PNL from remaining positions
             updatePositionsPNL(closedContractAddress, currentPrice); // Call this to recalculate the total PNL displayed

            localStorage.setItem('historyTotalPnl', state.historyTotalPnl.toString());
            resetPagination(); // Reset to page 1 after closing a position affects history
            saveState();
            updateUI(); // Update balance, positions list, history list
        } else {
            throw new Error('Invalid price received from API during close.');
        }
    } catch (error) {
        console.error('Error closing position:', error);
        alert(`Error closing position: ${error.message}. Please try again.`);
    }
}


// --- Functions related to PNL Card, Saving, Time Held ---
// (No changes needed in these based on the API endpoint switch)

// Add closePnlCard to window object so it can be called from HTML
window.closePnlCard = closePnlCard;

// Function to save PNL Card as image
async function savePnlCard() {
     // Ensure html2canvas is loaded
     if (typeof html2canvas === 'undefined') {
         console.error('html2canvas library is not loaded.');
         alert('Error: Image generation library not found.');
         return;
     }

    const saveBtn = document.querySelector('.save-image-btn');
    const pnlCard = document.querySelector('.pnl-card'); // Target the card itself

    if (!pnlCard || !saveBtn) {
        console.error('PNL Card or Save Button element not found.');
        return;
    }


    // Add loading state
    saveBtn.disabled = true; // Disable button
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; // Use fa-spin for animation

    try {
        // Capture the card
        const canvas = await html2canvas(pnlCard, {
            backgroundColor: '#1E293B', // Match card background (adjust if needed)
            scale: 2, // Higher quality
            useCORS: true, // Important if images are from external sources (like token logos)
            logging: false // Disable extensive logging in console
        });

        // Create download link
        const link = document.createElement('a');
        const timestamp = new Date().getTime();
         const filename = `pnl-card-${timestamp}.png`; // Use timestamp for unique names
        link.download = filename;
        link.href = canvas.toDataURL('image/png'); // Specify PNG format
        link.click(); // Trigger download

        // Reset button state after a short delay
        setTimeout(() => {
            saveBtn.disabled = false;
             saveBtn.innerHTML = '<i class="fas fa-download"></i> Save as Image';
        }, 500);

    } catch (error) {
        console.error('Error saving image:', error);
        alert('Error saving image. Please check console for details.');

        // Reset button state on error
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-download"></i> Save as Image';
    }
}

// Helper function to calculate time held
function calculateTimeHeld(startDate, endDate) {
    try{
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return 'Invalid Date'; // Handle invalid date inputs
        }

        const diffTime = Math.abs(end - start); // Difference in milliseconds
        const diffSeconds = Math.floor(diffTime / 1000);
        const diffMinutes = Math.floor(diffSeconds / 60);
        const diffHours = Math.floor(diffMinutes / 60);
        const diffDays = Math.floor(diffHours / 24);

        const minutes = diffMinutes % 60;
        const hours = diffHours % 24;
        const days = diffDays;

        let result = '';
        if (days > 0) {
            result += `${days}d `;
        }
        if (hours > 0 || days > 0) { // Show hours if days > 0 or hours > 0
            result += `${hours}h `;
        }
        result += `${minutes}m`; // Always show minutes

        return result.trim();
     } catch (e) {
         console.error("Error calculating time held:", e);
         return "Error";
     }
}

// Function to show PNL Card
function showPnlCard(position, currentPrice, pnl) {
    const timeHeld = calculateTimeHeld(position.timestamp, new Date().toISOString());
     let percentageChange = 0;
     if (position.entryPrice !== 0) {
         percentageChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
     } else if (currentPrice > 0) {
         percentageChange = Infinity; // Handle division by zero if entry price was 0
     }

    // Determine class based on PNL
     const pnlClass = pnl > 0 ? 'profit' : (pnl < 0 ? 'loss' : 'neutral'); // Added neutral for 0 PNL


    const modalHtml = `
        <div class="pnl-modal">
            <div class="pnl-card">
                <button class="pnl-close" onclick="closePnlCard()" aria-label="Close PNL Card">
                    <i class="fas fa-times"></i>
                </button>
                <div class="pnl-header">
                    <div class="pnl-token">
                        <img src="${position.tokenImg || 'placeholder.png'}" alt="${position.symbol}" onerror="this.src='placeholder.png';">
                        <span class="pnl-title">${position.symbol || 'N/A'}</span>
                    </div>
                    <div class="pnl-amount ${pnlClass}">
                         ${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}
                    </div>
                    <div class="pnl-percentage ${pnlClass}">
                        (${percentageChange === Infinity ? '∞' : (percentageChange >= 0 ? '+' : '') + percentageChange.toFixed(2)}%)
                    </div>
                </div>
                <div class="pnl-details">
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Entry Price</div>
                        <div class="pnl-detail-value">$${formatPrice(position.entryPrice)}</div>
                    </div>
                    <div class="pnl-detail-item">
                        <div class="pnl-detail-label">Exit Price</div>
                        <div class="pnl-detail-value">$${formatPrice(currentPrice)}</div>
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
                    <p>PNL Card from <a href="https://simulatorsolana.netlify.app" target="_blank" rel="noopener noreferrer" class="site-link">SimulatorSolana</a>. Trading involves risk. DYOR.</p>
                </div>
                <div class="pnl-actions">
                    <button class="save-image-btn" onclick="savePnlCard()">
                        <i class="fas fa-download"></i> Save as Image
                    </button>
                </div>
            </div>
        </div>
    `;

    // Remove any existing modal first
    const existingModal = document.querySelector('.pnl-modal');
    if (existingModal) {
        existingModal.remove();
    }

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    // Use requestAnimationFrame for smoother transition start
    requestAnimationFrame(() => {
         const modal = document.querySelector('.pnl-modal');
         if (modal) {
             modal.classList.add('show');
         }
    });

}


// Function to close PNL Card
function closePnlCard() {
    const modal = document.querySelector('.pnl-modal');
    if (modal) {
        modal.classList.remove('show');
        // Remove the element after the transition completes
        modal.addEventListener('transitionend', () => {
             if(modal) modal.remove(); // Check if modal still exists before removing
        }, { once: true }); // Ensure the event listener is removed after firing once
     }
}

// Save state to localStorage
function saveState() {
    try {
        localStorage.setItem('balance', state.balance.toString());
        localStorage.setItem('positions', JSON.stringify(state.positions));
        localStorage.setItem('history', JSON.stringify(state.history));
        localStorage.setItem('totalPnl', state.totalPnl.toString());
        localStorage.setItem('historyTotalPnl', state.historyTotalPnl.toString()); // Also save history total PNL
    } catch (error) {
        console.error("Error saving state to localStorage:", error);
        // Maybe notify the user that their session might not be saved
        alert("Warning: Could not save session data. localStorage might be full or disabled.");
    }
}

// --- Render Functions ---

function renderPositions() {
    elements.activePositions.textContent = state.positions.length;

    if (state.positions.length === 0) {
        elements.openPositions.innerHTML = '<p class="text-center text-gray-500">No active positions.</p>'; // Display message when no positions
         elements.totalPnl.textContent = '0.00'; // Reset total PNL display
         elements.totalPnlContainer.className = 'stat-value'; // Reset PNL color
    } else {
        elements.openPositions.innerHTML = state.positions.map((position, index) => `
            <div class="position-card">
                <div class="position-header">
                    <div class="position-token">
                        <img src="${position.tokenImg || 'placeholder.png'}" alt="${position.symbol}" class="token-image" onerror="this.src='placeholder.png';">
                        <h3>${position.symbol || 'N/A'}</h3>
                         <a href="https://solscan.io/token/${position.contractAddress}" target="_blank" rel="noopener noreferrer" class="contract-link" title="View on Solscan">
                             <i class="fas fa-external-link-alt"></i>
                         </a>
                    </div>
                    <button onclick="closePosition(${index})" class="close-button" aria-label="Close position for ${position.symbol}">Close</button>
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
                        <div class="stat-value" id="pnl-${index}">Calculating...</div>
                    </div>
                </div>
                 <div class="position-footer">
                     <small>Opened: ${new Date(position.timestamp).toLocaleString()}</small>
                 </div>
            </div>
        `).join('');

         // After rendering, immediately trigger PNL calculation for all positions
         // using the last known prices. Also restarts price updates.
         let needsRecalc = false;
         state.positions.forEach(position => {
             if (state.lastPrices[position.contractAddress] !== undefined) {
                 updatePositionsPNL(position.contractAddress, state.lastPrices[position.contractAddress]);
             } else {
                 needsRecalc = true; // Mark if any price is missing
             }
             startPriceUpdates(position.contractAddress); // Ensure updates are running
         });
         // If any price was missing, recalculate the total PNL figure after individual updates
          if (needsRecalc) {
             updatePositionsPNL(null, null); // Pass null to trigger total recalc based on current state.lastPrices
          }

    }
}


// Export to CSV function (changed from Excel to CSV for simplicity)
function exportToCsv() {
    if (state.history.length === 0) {
        alert("No trade history to export.");
        return;
    }

    // Create CSV header
    const header = ['Symbol', 'Entry Date', 'Entry Time', 'Exit Date', 'Exit Time', 'Entry Price', 'Exit Price', 'Quantity', 'Investment', 'PNL ($)', 'Contract Address'];
    let csvContent = header.join(',') + '\n';

    // Sort history by closed date descending for export
    const sortedHistory = [...state.history].sort((a, b) => {
         const dateA = a.closedAt ? new Date(a.closedAt) : new Date(0);
         const dateB = b.closedAt ? new Date(b.closedAt) : new Date(0);
         return dateB - dateA;
     });


    // Add data rows
    sortedHistory.forEach(trade => {
         const entryDate = new Date(trade.timestamp);
         const exitDate = new Date(trade.closedAt);

        const row = [
            `"${trade.symbol || 'N/A'}"`, // Enclose in quotes if symbol might have commas
             entryDate.toLocaleDateString(),
             entryDate.toLocaleTimeString(),
             exitDate.toLocaleDateString(),
             exitDate.toLocaleTimeString(),
             trade.entryPrice.toString(), // Use full precision numbers
             trade.exitPrice.toString(),
             trade.quantity.toString(),
             trade.amount.toFixed(2),
             trade.pnl.toFixed(2),
             `"${trade.contractAddress}"` // Enclose address in quotes
        ];
        csvContent += row.join(',') + '\n';
    });

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    link.setAttribute('download', `trade_history_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
     URL.revokeObjectURL(url); // Clean up blob URL
}


// --- Pagination Event Listeners ---
document.getElementById('prevPage').addEventListener('click', () => {
    if (state.currentPage > 1) {
        state.currentPage--;
        renderHistory(); // Re-render history for the new page
        updatePaginationControls(); // Update button states and page info
    }
});

document.getElementById('nextPage').addEventListener('click', () => {
    if (state.currentPage < getTotalPages()) {
        state.currentPage++;
        renderHistory(); // Re-render history for the new page
        updatePaginationControls(); // Update button states and page info
    }
});

// Attach export function to the button
document.getElementById('exportCsv').addEventListener('click', exportToCsv); // Changed ID and function name


// --- Render History Function ---
function renderHistory() {
    const pageData = getCurrentPageData(); // Gets sorted and paginated data

    if (pageData.length === 0 && state.history.length > 0) {
         // Handles case where current page might be beyond the last page after deletion/filtering
         state.currentPage = Math.max(1, state.currentPage -1); // Go back one page if possible
         renderHistory(); // Re-render with corrected page
         return;
     }


    if (pageData.length === 0) {
        elements.tradeHistory.innerHTML = '<p class="text-center text-gray-500">No trade history yet.</p>';
    } else {
        elements.tradeHistory.innerHTML = pageData.map(trade => {
            const pnlClass = trade.pnl > 0 ? 'profit' : (trade.pnl < 0 ? 'loss' : 'neutral');
            const entryDate = new Date(trade.timestamp);
            const exitDate = new Date(trade.closedAt);

            return `
            <div class="history-item">
                <div class="history-token">
                    <img src="${trade.tokenImg || 'placeholder.png'}" alt="${trade.symbol}" class="token-image" onerror="this.src='placeholder.png';">
                    <div>
                        <h4>${trade.symbol || 'N/A'}</h4>
                         <small title="${exitDate.toLocaleString()}">Closed: ${exitDate.toLocaleDateString()}</small>
                    </div>
                </div>
                <div class="trade-info">
                     <div class="pnl-value ${pnlClass}">
                         ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}
                    </div>
                    <div class="price-details" title="Entry: ${formatPrice(trade.entryPrice)} at ${entryDate.toLocaleString()}">
                        ${formatPrice(trade.entryPrice)} → ${formatPrice(trade.exitPrice)}
                    </div>
                </div>
            </div>
            `;
        }).join('');
    }

    // Update pagination controls *after* rendering the content
     updatePaginationControls();
}

// Function to clear contract input and related fields
function clearContract() {
    const contractInput = document.getElementById('contractAddress');
    const tradeAmountInput = document.getElementById('tradeAmount');

     const addressToClear = contractInput.value.trim();


    contractInput.value = '';
    if(tradeAmountInput) {
        tradeAmountInput.value = '';
    }

     // Hide token info section
     elements.tokenInfo.style.display = 'none';
     elements.tokenImage.src = ''; // Clear image
     elements.tokenName.textContent = '';
     elements.tokenPrice.textContent = '-';
     document.getElementById('contractDisplay').textContent = 'N/A';


    // Stop price updates for the cleared address if no positions exist for it
     if (addressToClear && !state.positions.some(p => p.contractAddress === addressToClear)) {
         clearPriceUpdateForAddress(addressToClear);
     }

    // Optional: Give focus back to the contract address input
    // contractInput.focus();
}


// Update UI - Central function to refresh displayed data
function updateUI() {
    // Update Balance
    elements.balance.textContent = state.balance.toFixed(2);

    // Update Total PNL for active positions (calculated in updatePositionsPNL)
    elements.totalPnl.textContent = state.totalPnl.toFixed(2);
    elements.totalPnlContainer.className = `stat-value ${state.totalPnl >= 0 ? 'profit' : 'loss'}`;

    // Update History Total PNL display
    const historyTotalPnlElement = document.getElementById('historyTotalPnl');
    if (historyTotalPnlElement) {
        historyTotalPnlElement.textContent = `${state.historyTotalPnl >= 0 ? '+' : ''}$${state.historyTotalPnl.toFixed(2)}`; // Add sign
        historyTotalPnlElement.className = `value ${state.historyTotalPnl >= 0 ? 'profit' : 'loss'}`;
    } else {
        console.warn("Element with ID 'historyTotalPnl' not found.");
    }


    renderPositions(); // Re-render active positions (this also triggers PNL updates)
    renderHistory(); // Re-render trade history (handles pagination)
     updatePaginationControls(); // Ensure controls are correct after potential history changes

    // Note: saveState() should be called specifically when state *changes* (buy, close), not necessarily on every UI update.
}

// Reset pagination (e.g., when history changes)
function resetPagination() {
    state.currentPage = 1;
    // No need to call updateUI here, the function calling resetPagination usually calls updateUI afterwards
}

// Cleanup function on window close/refresh
function cleanup() {
    console.log("Cleaning up intervals before page unload...");
    Object.keys(state.priceUpdateIntervals).forEach(address => {
        clearInterval(state.priceUpdateIntervals[address]);
    });
    state.priceUpdateIntervals = {};
     // Note: State is saved via saveState() during operations like buy/close.
     // No need to save state again here unless there's unsaved transient data.
}

// --- Initialization ---

// Attach the debounced input handler
elements.contractInput.addEventListener('input', handleInput);

// Initial UI setup on page load
document.addEventListener('DOMContentLoaded', () => {
     // Ensure DOM is fully loaded before trying to access elements
     console.log("DOM Loaded. Initializing UI.");
     updateUI();
     // Add other initial setup if needed
 });


// Global event listeners
window.addEventListener('beforeunload', cleanup);

// Make functions accessible globally if called directly from HTML (like onclick)
window.buyToken = buyToken;
window.closePosition = closePosition;
window.savePnlCard = savePnlCard;
window.closePnlCard = closePnlCard;
window.clearContract = clearContract; // Make clear function accessible


// Basic Error Handling for Uncaught Promises
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled Promise Rejection:', event.reason);
    // Basic user notification - avoid alerting for every minor issue
    // Consider a more subtle notification system (e.g., a toast message)
    // if (event.reason instanceof Error && event.reason.message.includes('Fluxbeam')) {
    //     // Maybe show a temporary indicator that price updates might be delayed
    // }
});

// Add listener for the clear button if it exists
const clearButton = document.getElementById('clearContractButton'); // Assuming you have a button with this ID
if (clearButton) {
    clearButton.addEventListener('click', clearContract);
} else {
     console.warn("Clear contract button not found (expected ID 'clearContractButton')");
}