// contracts/Game2048.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract Game2048 {
    struct Score {
        address player;
        uint256 score;
        uint256 timestamp;
        string playerName;
    }

    struct LeaderboardEntry {
        address player;
        string playerName;
        uint256 highScore;
        uint256 gamesPlayed;
        uint256 totalScore;
    }

    // State variables
    Score[] public allScores;
    mapping(address => LeaderboardEntry) public playerStats;
    address[] public players;
    
    uint256 public constant MAX_LEADERBOARD_SIZE = 100;
    uint256 public minScoreForLeaderboard = 0;
    
    // Events
    event NewHighScore(address indexed player, string playerName, uint256 score, uint256 timestamp);
    event GamePlayed(address indexed player, uint256 score, uint256 timestamp);
    
    // Submit a game score
    function submitScore(uint256 _score, string memory _playerName) public {
        require(_score > 0, "Score must be greater than 0");
        require(bytes(_playerName).length > 0, "Player name required");
        
        // Record the score
        allScores.push(Score({
            player: msg.sender,
            score: _score,
            timestamp: block.timestamp,
            playerName: _playerName
        }));
        
        // Update player stats
        LeaderboardEntry storage entry = playerStats[msg.sender];
        
        if (entry.gamesPlayed == 0) {
            players.push(msg.sender);
            entry.player = msg.sender;
            entry.playerName = _playerName;
        }
        
        entry.gamesPlayed++;
        entry.totalScore += _score;
        
        if (_score > entry.highScore) {
            entry.highScore = _score;
            entry.playerName = _playerName; // Update name with high score
            emit NewHighScore(msg.sender, _playerName, _score, block.timestamp);
        }
        
        emit GamePlayed(msg.sender, _score, block.timestamp);
    }
    
    // Get top N players
    function getTopPlayers(uint256 _count) public view returns (LeaderboardEntry[] memory) {
        uint256 count = _count;
        if (count > players.length) {
            count = players.length;
        }
        if (count > MAX_LEADERBOARD_SIZE) {
            count = MAX_LEADERBOARD_SIZE;
        }
        
        // Create array for sorting
        LeaderboardEntry[] memory allEntries = new LeaderboardEntry[](players.length);
        for (uint256 i = 0; i < players.length; i++) {
            allEntries[i] = playerStats[players[i]];
        }
        
        // Simple bubble sort (good enough for small leaderboard)
        for (uint256 i = 0; i < allEntries.length; i++) {
            for (uint256 j = i + 1; j < allEntries.length; j++) {
                if (allEntries[i].highScore < allEntries[j].highScore) {
                    LeaderboardEntry memory temp = allEntries[i];
                    allEntries[i] = allEntries[j];
                    allEntries[j] = temp;
                }
            }
        }
        
        // Return top N
        LeaderboardEntry[] memory topPlayers = new LeaderboardEntry[](count);
        for (uint256 i = 0; i < count; i++) {
            topPlayers[i] = allEntries[i];
        }
        
        return topPlayers;
    }
    
    // Get player stats
    function getPlayerStats(address _player) public view returns (LeaderboardEntry memory) {
        return playerStats[_player];
    }
    
    // Get recent scores
    function getRecentScores(uint256 _count) public view returns (Score[] memory) {
        uint256 count = _count;
        if (count > allScores.length) {
            count = allScores.length;
        }
        
        Score[] memory recentScores = new Score[](count);
        uint256 startIndex = allScores.length - count;
        
        for (uint256 i = 0; i < count; i++) {
            recentScores[i] = allScores[startIndex + i];
        }
        
        return recentScores;
    }
    
    // Get total number of games played
    function getTotalGamesPlayed() public view returns (uint256) {
        return allScores.length;
    }
}
