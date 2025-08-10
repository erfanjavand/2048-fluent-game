// backend/server.js
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);

// CORS configuration for GitHub Codespaces
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      process.env.FRONTEND_URL,
      // GitHub Codespaces patterns
      /https:\/\/.*\.app\.github\.dev$/,
      /https:\/\/.*\.github\.dev$/,
      // Other cloud IDE patterns
      /https:\/\/.*\.gitpod\.io$/,
      /https:\/\/.*\.csb\.app$/
    ];
    
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Apply CORS middleware
app.use(cors(corsOptions));
app.use(express.json());

// Socket.io with CORS
const io = new Server(httpServer, {
  cors: corsOptions,
  transports: ['websocket', 'polling']
});

// Contract setup
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const CONTRACT_ABI = [
  "function submitScore(uint256 _score, string memory _playerName) public",
  "function getTopPlayers(uint256 _count) public view returns (tuple(address player, string playerName, uint256 highScore, uint256 gamesPlayed, uint256 totalScore)[])",
  "function getPlayerStats(address _player) public view returns (uint256 highScore, uint256 gamesPlayed, uint256 totalScore, string memory playerName)",
  "event ScoreSubmitted(address indexed player, uint256 score, string playerName)"
];

// Provider and contract instance
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

// In-memory cache for leaderboard
let leaderboardCache = [];
let lastCacheUpdate = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Function to fetch leaderboard from blockchain
async function fetchLeaderboard() {
  try {
    console.log('Fetching leaderboard from blockchain...');
    const topPlayers = await contract.getTopPlayers(10);
    
    leaderboardCache = topPlayers.map(player => ({
      address: player.player,
      name: player.playerName || 'Anonymous',
      highScore: Number(player.highScore),
      gamesPlayed: Number(player.gamesPlayed),
      totalScore: Number(player.totalScore)
    })).sort((a, b) => b.highScore - a.highScore);
    
    lastCacheUpdate = Date.now();
    console.log('Leaderboard updated:', leaderboardCache.length, 'players');
    return leaderboardCache;
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return leaderboardCache; // Return cached data on error
  }
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    contract: CONTRACT_ADDRESS,
    network: process.env.RPC_URL
  });
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    // Check if cache is still valid
    if (Date.now() - lastCacheUpdate > CACHE_DURATION || leaderboardCache.length === 0) {
      await fetchLeaderboard();
    }
    
    res.json(leaderboardCache);
  } catch (error) {
    console.error('Error in /api/leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Send current leaderboard to new client
  socket.emit('leaderboardUpdate', leaderboardCache);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Listen for blockchain events
contract.on('ScoreSubmitted', async (player, score, playerName) => {
  console.log('New score submitted:', player, score, playerName);
  
  // Update leaderboard
  const updatedLeaderboard = await fetchLeaderboard();
  
  // Broadcast to all connected clients
  io.emit('leaderboardUpdate', updatedLeaderboard);
  
  // Notify about new high score
  io.emit('newHighScore', {
    player,
    score: Number(score),
    playerName
  });
});

// Initial leaderboard fetch
fetchLeaderboard().then(() => {
  console.log('Initial leaderboard loaded');
});

// Periodic leaderboard refresh
setInterval(async () => {
  const updated = await fetchLeaderboard();
  if (updated.length > 0) {
    io.emit('leaderboardUpdate', updated);
  }
}, 60000); // Refresh every minute

// Start server
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0'; // Important for cloud environments

httpServer.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log('Contract Address:', CONTRACT_ADDRESS);
  console.log('RPC URL:', process.env.RPC_URL);
  console.log('Frontend URL:', process.env.FRONTEND_URL);
});
