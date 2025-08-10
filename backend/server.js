// backend/server.js
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const CONTRACT_ABI = [
  "function getTopPlayers(uint256 _count) public view returns (tuple(address player, string playerName, uint256 highScore, uint256 gamesPlayed, uint256 totalScore)[])",
  "function getRecentScores(uint256 _count) public view returns (tuple(address player, uint256 score, uint256 timestamp, string playerName)[])",
  "function getTotalGamesPlayed() public view returns (uint256)",
  "event NewHighScore(address indexed player, string playerName, uint256 score, uint256 timestamp)",
  "event GamePlayed(address indexed player, uint256 score, uint256 timestamp)"
];

// Initialize provider
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://rpc.testnet.fluent.xyz/');
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

// Cache for leaderboard
let leaderboardCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60000; // 1 minute

// API Routes
app.get('/api/leaderboard', async (req, res) => {
  try {
    const now = Date.now();
    if (!leaderboardCache || now - cacheTimestamp > CACHE_DURATION) {
      const topPlayers = await contract.getTopPlayers(20);
      leaderboardCache = topPlayers.map(player => ({
        address: player.player,
        name: player.playerName,
        highScore: player.highScore.toString(),
        gamesPlayed: player.gamesPlayed.toString(),
        avgScore: player.gamesPlayed > 0 ? 
          (player.totalScore / player.gamesPlayed).toFixed(0) : '0'
      }));
      cacheTimestamp = now;
    }
    res.json(leaderboardCache);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.get('/api/recent-games', async (req, res) => {
  try {
    const recentScores = await contract.getRecentScores(10);
    const formatted = recentScores.map(score => ({
      player: score.player,
      playerName: score.playerName,
      score: score.score.toString(),
      timestamp: new Date(Number(score.timestamp) * 1000).toISOString()
    }));
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching recent games:', error);
    res.status(500).json({ error: 'Failed to fetch recent games' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const totalGames = await contract.getTotalGamesPlayed();
    res.json({
      totalGames: totalGames.toString()
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// WebSocket for real-time updates
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Listen to blockchain events
contract.on('NewHighScore', async (player, playerName, score, timestamp) => {
  console.log('New high score:', playerName, score.toString());
  
  // Update cache
  const topPlayers = await contract.getTopPlayers(20);
  leaderboardCache = topPlayers.map(player => ({
    address: player.player,
    name: player.playerName,
    highScore: player.highScore.toString(),
    gamesPlayed: player.gamesPlayed.toString(),
    avgScore: player.gamesPlayed > 0 ? 
      (player.totalScore / player.gamesPlayed).toFixed(0) : '0'
  }));
  cacheTimestamp = Date.now();
  
  // Emit to all connected clients
  io.emit('newHighScore', {
    player,
    playerName,
    score: score.toString(),
    timestamp: new Date(Number(timestamp) * 1000).toISOString()
  });
  
  io.emit('leaderboardUpdate', leaderboardCache);
});

contract.on('GamePlayed', (player, score, timestamp) => {
  io.emit('newGame', {
    player,
    score: score.toString(),
    timestamp: new Date(Number(timestamp) * 1000).toISOString()
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
