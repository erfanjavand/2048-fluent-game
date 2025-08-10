// frontend/src/App.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ethers } from 'ethers';
import toast, { Toaster } from 'react-hot-toast';
import io from 'socket.io-client';
import './App.css';

// Game constants
const GRID_SIZE = 4;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

// Dynamic backend URL detection
const getBackendUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }
  
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  
  if (hostname.includes('github.dev')) {
    return `${protocol}//${hostname.replace('-5173', '-3001')}`;
  }
  
  if (hostname.includes('csb.app')) {
    return `${protocol}//${hostname.replace('5173', '3001')}`;
  }
  
  if (hostname.includes('gitpod.io')) {
    return `${protocol}//3001-${hostname.split('-')[1]}`;
  }
  
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }
  
  return `${protocol}//${hostname}:3001`;
};

// Contract configuration
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x51041c822b72899aaa3a6baa9a07f92a33efa1fe";
const CONTRACT_ABI = [
  "function submitScore(uint256 _score, string memory _playerName) public",
  "function getTopPlayers(uint256 _count) public view returns (tuple(address player, string playerName, uint256 highScore, uint256 gamesPlayed, uint256 totalScore)[])",
  "function getPlayerStats(address _player) public view returns (uint256 highScore, uint256 gamesPlayed, uint256 totalScore, string memory playerName)"
];

// Fluent Network Configuration
const FLUENT_NETWORK = {
  chainId: '0x5202', // 1555 in hex
  chainName: 'Fluent Devnet',
  nativeCurrency: {
    name: 'Fluent',
    symbol: 'FLU',
    decimals: 18
  },
  rpcUrls: ['https://rpc.testnet.fluent.xyz/'],
  blockExplorerUrls: ['https://blockscout.testnet.fluent.xyz/']
};

function App() {
  // State management
  const [grid, setGrid] = useState([]);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [account, setAccount] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingScore, setPendingScore] = useState(0);
  const [socket, setSocket] = useState(null);
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false);
  
  const touchStartRef = useRef({ x: null, y: null });
  const gridRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    const backendUrl = getBackendUrl();
    console.log('Connecting to backend:', backendUrl);
    
    const newSocket = io(backendUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('Connected to backend');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    newSocket.on('leaderboardUpdate', (newLeaderboard) => {
      setLeaderboard(newLeaderboard);
    });

    newSocket.on('newHighScore', (data) => {
      toast.success(`New high score by ${data.playerName}: ${data.score}!`, {
        duration: 5000,
        position: 'top-center',
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Network management functions
  const addFluentNetwork = async () => {
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [FLUENT_NETWORK]
      });
      return true;
    } catch (error) {
      console.error('Error adding Fluent network:', error);
      if (error.code === 4001) {
        toast.error('Please approve adding Fluent network to continue');
      } else {
        toast.error('Failed to add Fluent network');
      }
      return false;
    }
  };

  const switchToFluentNetwork = async () => {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: FLUENT_NETWORK.chainId }]
      });
      return true;
    } catch (error) {
      console.error('Error switching network:', error);
      
      // If network doesn't exist (code 4902 or the error message indicates unrecognized chain)
      if (error.code === 4902 || 
          error.code === -32603 || 
          error.message?.includes('Unrecognized chain') ||
          error.message?.includes('wallet_addEthereumChain')) {
        
        toast.loading('Adding Fluent network...', { id: 'add-network' });
        
        try {
          // Try to add the network
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [FLUENT_NETWORK]
          });
          
          toast.success('Fluent network added!', { id: 'add-network' });
          
          // After adding, try to switch again
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: FLUENT_NETWORK.chainId }]
            });
            return true;
          } catch (switchError) {
            console.error('Error switching after adding:', switchError);
            toast.error('Please manually switch to Fluent network', { id: 'add-network' });
            return false;
          }
        } catch (addError) {
          console.error('Error adding network:', addError);
          toast.error('Failed to add Fluent network', { id: 'add-network' });
          return false;
        }
      }
      
      if (error.code === 4001) {
        toast.error('Network switch cancelled');
      } else {
        toast.error('Please switch to Fluent network to continue');
      }
      return false;
    }
  };

  const checkNetwork = async () => {
    if (!window.ethereum) return false;
    
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      const isCorrect = chainId === FLUENT_NETWORK.chainId;
      setIsCorrectNetwork(isCorrect);
      return isCorrect;
    } catch (error) {
      console.error('Error checking network:', error);
      return false;
    }
  };

  // Initialize Web3 with network check
  useEffect(() => {
    const initWeb3 = async () => {
      if (typeof window.ethereum !== 'undefined') {
        try {
          // Check network first
          await checkNetwork();
          
          const provider = new ethers.BrowserProvider(window.ethereum);
          const network = await provider.getNetwork();
          console.log('Connected to network:', network);
          
          if (CONTRACT_ADDRESS && CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
            const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
            setContract(contractInstance);
          }
        } catch (error) {
          console.error('Error initializing Web3:', error);
        }
      }
    };

    initWeb3();
  }, []);

  // Listen for network changes
  useEffect(() => {
    if (window.ethereum) {
      const handleChainChanged = async (chainId) => {
        console.log('Network changed to:', chainId);
        
        const isCorrect = chainId === FLUENT_NETWORK.chainId;
        setIsCorrectNetwork(isCorrect);
        
        if (!isCorrect && account) {
          toast.error('Please switch back to Fluent network!', {
            duration: 5000,
            position: 'top-center'
          });
          // Disconnect wallet if wrong network
          setAccount(null);
          setSigner(null);
        } else if (isCorrect && !account && window.ethereum.selectedAddress) {
          // Reconnect if switched back to correct network
          connectWallet();
        }
      };

      const handleAccountsChanged = (accounts) => {
        if (accounts.length === 0) {
          // User disconnected wallet
          setAccount(null);
          setSigner(null);
        } else if (accounts[0] !== account) {
          // User switched accounts
          checkNetwork().then(isCorrect => {
            if (isCorrect) {
              connectWallet();
            }
          });
        }
      };
      
      window.ethereum.on('chainChanged', handleChainChanged);
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      
      return () => {
        window.ethereum.removeListener('chainChanged', handleChainChanged);
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      };
    }
  }, [account]);

  // Load leaderboard
  const loadLeaderboard = useCallback(async () => {
    try {
      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/api/leaderboard`);
      const data = await response.json();
      setLeaderboard(data);
    } catch (error) {
      console.error('Error loading leaderboard:', error);
    }
  }, []);

  // Load leaderboard on mount
  useEffect(() => {
    loadLeaderboard();
    const interval = setInterval(loadLeaderboard, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [loadLeaderboard]);

  // Game initialization
  const initializeGrid = useCallback(() => {
    const newGrid = Array(CELL_COUNT).fill(0);
    addNewTile(newGrid);
    addNewTile(newGrid);
    return newGrid;
  }, []);

  useEffect(() => {
    const savedBest = localStorage.getItem('bestScore');
    if (savedBest) setBestScore(parseInt(savedBest));
    setGrid(initializeGrid());
  }, [initializeGrid]);

  // Game logic functions
  const addNewTile = (currentGrid) => {
    const emptyCells = [];
    currentGrid.forEach((cell, index) => {
      if (cell === 0) emptyCells.push(index);
    });

    if (emptyCells.length > 0) {
      const randomIndex = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      currentGrid[randomIndex] = Math.random() < 0.9 ? 2 : 4;
    }
  };

  const move = (direction) => {
    if (gameOver) return;

    const newGrid = [...grid];
    let moved = false;
    let points = 0;

    const moveRow = (row) => {
      const filtered = row.filter(val => val !== 0);
      const merged = [];
      
      for (let i = 0; i < filtered.length; i++) {
        if (i < filtered.length - 1 && filtered[i] === filtered[i + 1]) {
          merged.push(filtered[i] * 2);
          points += filtered[i] * 2;
          i++;
        } else {
          merged.push(filtered[i]);
        }
      }
      
      while (merged.length < GRID_SIZE) {
        merged.push(0);
      }
      
      return merged;
    };

    if (direction === 'left' || direction === 'right') {
      for (let i = 0; i < GRID_SIZE; i++) {
        const row = [];
        for (let j = 0; j < GRID_SIZE; j++) {
          row.push(newGrid[i * GRID_SIZE + j]);
        }
        
        const movedRow = direction === 'left' ? moveRow(row) : moveRow(row.reverse()).reverse();
        
        for (let j = 0; j < GRID_SIZE; j++) {
          if (newGrid[i * GRID_SIZE + j] !== movedRow[j]) moved = true;
          newGrid[i * GRID_SIZE + j] = movedRow[j];
        }
      }
    } else {
      for (let j = 0; j < GRID_SIZE; j++) {
        const column = [];
        for (let i = 0; i < GRID_SIZE; i++) {
          column.push(newGrid[i * GRID_SIZE + j]);
        }
        
        const movedColumn = direction === 'up' ? moveRow(column) : moveRow(column.reverse()).reverse();
        
        for (let i = 0; i < GRID_SIZE; i++) {
          if (newGrid[i * GRID_SIZE + j] !== movedColumn[i]) moved = true;
          newGrid[i * GRID_SIZE + j] = movedColumn[i];
        }
      }
    }

    if (moved) {
      addNewTile(newGrid);
      setGrid(newGrid);
      const newScore = score + points;
      setScore(newScore);
      
      if (newScore > bestScore) {
        setBestScore(newScore);
        localStorage.setItem('bestScore', newScore.toString());
      }
      
      if (checkGameOver(newGrid)) {
        setGameOver(true);
        handleGameOver(newScore);
      }
    }
  };

  const checkGameOver = (currentGrid) => {
    if (currentGrid.includes(0)) return false;

    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        const current = currentGrid[i * GRID_SIZE + j];
        
        if (j < GRID_SIZE - 1 && current === currentGrid[i * GRID_SIZE + j + 1]) return false;
        if (i < GRID_SIZE - 1 && current === currentGrid[(i + 1) * GRID_SIZE + j]) return false;
      }
    }
    
    return true;
  };

  const handleGameOver = (finalScore) => {
    toast.error(`Game Over! Final Score: ${finalScore}`, {
      duration: 3000,
      position: 'top-center',
    });
  };

  // Keyboard controls
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'ArrowUp') move('up');
      else if (e.key === 'ArrowDown') move('down');
      else if (e.key === 'ArrowLeft') move('left');
      else if (e.key === 'ArrowRight') move('right');
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [grid, score, gameOver]);

  // Touch controls
  const handleTouchStart = (e) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e) => {
    if (!touchStartRef.current.x || !touchStartRef.current.y) return;

    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    const minSwipeDistance = 50;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (Math.abs(deltaX) > minSwipeDistance) {
        move(deltaX > 0 ? 'right' : 'left');
      }
    } else {
      if (Math.abs(deltaY) > minSwipeDistance) {
        move(deltaY > 0 ? 'down' : 'up');
      }
    }

    touchStartRef.current = { x: null, y: null };
  };

  // Updated Web3 functions with network management
  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        // First check and switch to Fluent network
        const isFluentNetwork = await checkNetwork();
        
        if (!isFluentNetwork) {
          toast.loading('Switching to Fluent network...', { id: 'network-switch' });
          const switched = await switchToFluentNetwork();
          toast.dismiss('network-switch');
          
          if (!switched) {
            toast.error('Failed to switch to Fluent network. Please switch manually.', {
              duration: 5000
            });
            return;
          }
          
          toast.success('Switched to Fluent network!');
        }
        
        // Then connect wallet
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signerInstance = await provider.getSigner();
        
        setAccount(accounts[0]);
        setSigner(signerInstance);
        
        if (contract) {
          const contractWithSigner = contract.connect(signerInstance);
          setContract(contractWithSigner);
        }
        
        toast.success('Wallet connected!');
      } catch (error) {
        console.error('Error connecting wallet:', error);
        if (error.code === 4001) {
          toast.error('Connection cancelled by user');
        } else {
          toast.error('Failed to connect wallet');
        }
      }
    } else {
      toast.error('Please install MetaMask!');
      window.open('https://metamask.io/download/', '_blank');
    }
  };

  const handleSubmitScore = async () => {
    if (!account) {
      toast.error('Please connect your wallet first!');
      return;
    }
    
    // Double-check network before submitting
    const isFluentNetwork = await checkNetwork();
    if (!isFluentNetwork) {
      toast.loading('Switching to Fluent network...', { id: 'network-check' });
      const switched = await switchToFluentNetwork();
      toast.dismiss('network-check');
      
      if (!switched) {
        toast.error('Please switch to Fluent network to submit your score!', {
          duration: 5000
        });
        return;
      }
    }
    
    setPendingScore(score);
    setShowNameModal(true);
  };

  const submitScoreToBlockchain = async () => {
    if (!contract || !signer || !playerName.trim()) return;

    // Final network check before transaction
    const isFluentNetwork = await checkNetwork();
    if (!isFluentNetwork) {
      toast.error('Wrong network! Please switch to Fluent network.');
      setShowNameModal(false);
      return;
    }

    setIsSubmitting(true);
    try {
      const tx = await contract.submitScore(pendingScore, playerName);
      toast.loading('Submitting score to blockchain...', { id: 'submit' });
      
      await tx.wait();
      
      toast.success('Score submitted successfully!', { id: 'submit' });
      setShowNameModal(false);
      
      // Refresh leaderboard
      setTimeout(loadLeaderboard, 2000);
    } catch (error) {
      console.error('Error submitting score:', error);
      
      if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
        toast.error('Transaction cancelled', { id: 'submit' });
      } else if (error.code === 'INSUFFICIENT_FUNDS') {
        toast.error('Insufficient funds for transaction', { id: 'submit' });
      } else {
        toast.error('Failed to submit score', { id: 'submit' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const newGame = () => {
    setGrid(initializeGrid());
    setScore(0);
    setGameOver(false);
  };

  // Tile color helper
  const getTileColor = (value) => {
    const colors = {
      0: 'bg-gray-200',
      2: 'bg-gray-100',
      4: 'bg-yellow-100',
      8: 'bg-yellow-200',
      16: 'bg-orange-200',
      32: 'bg-orange-300',
      64: 'bg-orange-400',
      128: 'bg-red-300',
      256: 'bg-red-400',
      512: 'bg-red-500',
      1024: 'bg-purple-400',
      2048: 'bg-purple-500',
    };
    return colors[value] || 'bg-purple-600';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white">
      <Toaster />
      
      {/* Header */}
      <header className="p-4 flex justify-between items-center">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-pink-400">
          Blockchain 2048
        </h1>
        <div className="flex items-center gap-4">
          {account && !isCorrectNetwork && (
            <span className="text-yellow-400 text-sm">
              ⚠️ Wrong Network
            </span>
          )}
          <button
            onClick={connectWallet}
            className="px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all transform hover:scale-105"
          >
            {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Game Section */}
          <div className="lg:col-span-2">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 shadow-2xl">
              {/* Score Display */}
              <div className="flex justify-between mb-6">
                <div className="bg-white/20 rounded-lg p-4">
                  <p className="text-sm opacity-80">Score</p>
                  <p className="text-2xl font-bold">{score}</p>
                </div>
                <div className="bg-white/20 rounded-lg p-4">
                  <p className="text-sm opacity-80">Best</p>
                  <p className="text-2xl font-bold">{bestScore}</p>
                </div>
              </div>

              {/* Game Grid */}
              <div
                ref={gridRef}
                className="relative bg-gray-800/50 rounded-xl p-4 aspect-square max-w-md mx-auto touch-none"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <div className="grid grid-cols-4 gap-2 h-full">
                  <AnimatePresence>
                    {grid.map((value, index) => (
                      <motion.div
                        key={`${index}-${value}`}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        className={`${getTileColor(value)} rounded-lg flex items-center justify-center font-bold text-2xl text-gray-800 shadow-lg`}
                      >
                        {value > 0 && value}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>

              {/* Controls */}
              <div className="flex gap-4 mt-6 justify-center">
                <button
                  onClick={newGame}
                  className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg hover:from-green-600 hover:to-emerald-600 transition-all transform hover:scale-105"
                >
                  New Game
                </button>
                <button
                  onClick={handleSubmitScore}
                  disabled={score === 0 || !account}
                  className="px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg hover:from-blue-600 hover:to-cyan-600 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit Score
                </button>
              </div>

              {/* Instructions */}
              <div className="mt-6 text-center text-sm opacity-80">
                <p>Use arrow keys or swipe to play</p>
                <p className="mt-1">Join tiles to reach 2048!</p>
                {!isCorrectNetwork && account && (
                  <p className="mt-2 text-yellow-400">
                    Please switch to Fluent network to submit scores
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Leaderboard Section */}
          <div className="lg:col-span-1">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 shadow-2xl">
              <h2 className="text-2xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-pink-400">
                Leaderboard
              </h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {leaderboard.length === 0 ? (
                  <p className="text-center opacity-50 py-8">No scores yet. Be the first!</p>
                ) : (
                  leaderboard.map((player, index) => (
                    <motion.div
                      key={player.address}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="bg-white/10 rounded-lg p-3 flex justify-between items-center"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold ${index < 3 ? 'text-yellow-400' : ''}`}>
                          #{index + 1}
                        </span>
                        <div>
                          <p className="font-semibold">{player.name || 'Anonymous'}</p>
                          <p className="text-xs opacity-70">{player.address.slice(0, 6)}...{player.address.slice(-4)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{player.highScore}</p>
                        <p className="text-xs opacity-70">{player.gamesPlayed} games</p>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Name Modal */}
      <AnimatePresence>
        {showNameModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={() => !isSubmitting && setShowNameModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gradient-to-br from-purple-800 to-blue-800 rounded-2xl p-8 max-w-md w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-2xl font-bold mb-4">Submit Your Score</h3>
              <p className="text-lg mb-6">Score: {pendingScore}</p>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 placeholder-white/50 mb-6 text-white"
                maxLength={20}
              />
              <div className="flex gap-4">
                <button
                  onClick={submitScoreToBlockchain}
                  disabled={isSubmitting || !playerName.trim()}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg hover:from-green-600 hover:to-emerald-600 transition-all disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
                <button
                  onClick={() => setShowNameModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 px-6 py-3 bg-gray-600 rounded-lg hover:bg-gray-700 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
