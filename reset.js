function resetToInitial() {
    if (!confirm('Are you sure you want to reset everything? This will clear all trading history and set balance to $100.')) {
        return;
    }
    
    const initialState = {
        balance: 100,
        positions: [],
        history: [],
        totalPnl: 0,
        historyTotalPnl: 0
    };

    localStorage.setItem('balance', initialState.balance);
    localStorage.setItem('positions', JSON.stringify(initialState.positions));
    localStorage.setItem('history', JSON.stringify(initialState.history));
    localStorage.setItem('totalPnl', initialState.totalPnl);
    localStorage.setItem('historyTotalPnl', initialState.historyTotalPnl);
    localStorage.removeItem('lastPrices');
    localStorage.removeItem('priceUpdateIntervals');

    location.reload();
}

function deleteTradesByContract(contractAddress) {
    if (!contractAddress) {
        alert('Please enter a contract address');
        return;
    }
    
    if (!confirm(`Are you sure you want to delete all trades for ${contractAddress}?`)) {
        return;
    }

    let currentState = {
        positions: JSON.parse(localStorage.getItem('positions')) || [],
        history: JSON.parse(localStorage.getItem('history')) || [],
        balance: parseFloat(localStorage.getItem('balance')) || 100
    };

    const contractTrades = currentState.history.filter(
        trade => trade.contractAddress === contractAddress
    );

    if (contractTrades.length === 0) {
        alert('No trades found for this contract address');
        return;
    }

    const contractPnL = contractTrades.reduce((total, trade) => total + trade.pnl, 0);
    const newBalance = currentState.balance - contractPnL;

    currentState.history = currentState.history.filter(
        trade => trade.contractAddress !== contractAddress
    );
    currentState.positions = currentState.positions.filter(
        position => position.contractAddress !== contractAddress
    );

    localStorage.setItem('positions', JSON.stringify(currentState.positions));
    localStorage.setItem('history', JSON.stringify(currentState.history));
    localStorage.setItem('balance', newBalance);
    
    const newTotalPnL = currentState.history.reduce((total, trade) => total + trade.pnl, 0);
    localStorage.setItem('totalPnl', newTotalPnL);
    localStorage.setItem('historyTotalPnl', newTotalPnL);

    location.reload();
}

function resetContractBalance(contractAddress) {
    if (!contractAddress) {
        alert('Please enter a contract address');
        return;
    }
    
    if (!confirm(`Are you sure you want to reset balance for ${contractAddress}?`)) {
        return;
    }

    let currentState = {
        positions: JSON.parse(localStorage.getItem('positions')) || [],
        history: JSON.parse(localStorage.getItem('history')) || [],
        balance: parseFloat(localStorage.getItem('balance')) || 100
    };

    const contractTrades = currentState.history.filter(
        trade => trade.contractAddress === contractAddress
    );

    if (contractTrades.length === 0) {
        alert('No trades found for this contract address');
        return;
    }

    currentState.history = currentState.history.filter(
        trade => trade.contractAddress !== contractAddress
    );
    currentState.positions = currentState.positions.filter(
        position => position.contractAddress !== contractAddress
    );

    localStorage.setItem('positions', JSON.stringify(currentState.positions));
    localStorage.setItem('history', JSON.stringify(currentState.history));
    
    const newTotalPnL = currentState.history.reduce((total, trade) => total + trade.pnl, 0);
    localStorage.setItem('totalPnl', newTotalPnL);
    localStorage.setItem('historyTotalPnl', newTotalPnL);
    
    location.reload();
}