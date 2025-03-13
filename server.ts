const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { z } = require('zod');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'dist')));

// Explicitly serve the smiley image
app.get('/smiley.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'smiley.png'));
});

// Type definitions
const PlayerSchema = z.object({
  id: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  }),
  rotation: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
  color: z.string().optional(),
});

// Expanded soft watercolor palette with more variations
const WATERCOLOR_PALETTE = [
  '#daeced', // softer blue
  '#f7ece5', // softer peach
  '#e6f0e7', // softer mint
  '#fcf3f3', // softer pink
  '#f2ebf5', // softer lavender
  '#faf6ed', // softer yellow
  '#ebf1f5', // softer sky blue
  '#eee7e0', // softer taupe
  '#f7f0f4', // softer rose
  '#ebf2ee', // softer sage
  '#e5f4fb', // baby blue
  '#f9e1dd', // light coral
  '#e8f6e8', // mint cream
  '#fcf0f0', // misty rose
  '#eae0f2', // light lavender
  '#fcf4e1', // light yellow
  '#e2ebf3', // powder blue
  '#f2e9e1', // antique white
  '#f7eaf4', // pale pink
  '#e7ede4', // pale green
  '#e3f1f4', // pale cyan
  '#f2e8e5', // pale peach
  '#efedf5', // pale violet
  '#f8f3e2', // pale yellow
  '#dfe9f3', // pale blue
  '#eeebe2', // ecru
  '#f0ece4', // eggshell
  '#e0f0e3', // honeydew
  '#faf0e6', // linen
  '#f5efd5'  // papaya whip
];

// Keep track of used colors
const usedColors = new Set();

// Function to get a unique color - improved algorithm
function getUniqueColor() {
  // If all colors are used, generate random variations
  if (usedColors.size >= WATERCOLOR_PALETTE.length / 2) {
    // Generate a unique pastel color with more variety
    const h = Math.floor(Math.random() * 360);
    const s = 15 + Math.floor(Math.random() * 25); // 15-40% saturation
    const l = 80 + Math.floor(Math.random() * 15); // 80-95% lightness
    const color = `hsl(${h}, ${s}%, ${l}%)`;
    
    // Only add to usedColors if we're not overflowing the set
    if (usedColors.size < 100) { // Cap at 100 colors to prevent memory issues
      usedColors.add(color);
    }
    
    return color;
  }
  
  // Find an unused color from the palette
  for (const possibleColor of WATERCOLOR_PALETTE) {
    if (!usedColors.has(possibleColor)) {
      usedColors.add(possibleColor);
      return possibleColor;
    }
  }
  
  // Fallback - should never reach here, but just in case
  const randomColor = WATERCOLOR_PALETTE[Math.floor(Math.random() * WATERCOLOR_PALETTE.length)];
  return randomColor;
}

// Store all connected players
const players = new Map();

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Handle new player joining
  socket.on('joinGame', (playerData) => {
    try {
      const player = PlayerSchema.parse(playerData);
      
      // Assign a unique color regardless of what the client suggested
      player.color = getUniqueColor();
      
      players.set(socket.id, player);
      
      // Notify everyone about the new player
      io.emit('playerJoined', player);
      
      // Send existing players to the new player
      players.forEach((existingPlayer) => {
        if (existingPlayer.id !== socket.id) {
          socket.emit('playerJoined', existingPlayer);
        }
      });
      
      console.log(`Player ${socket.id} joined the game with color ${player.color}`);
    } catch (error) {
      console.error('Invalid player data:', error);
    }
  });

  // Handle player movement
  socket.on('movePlayer', (moveData) => {
    try {
      const parsedData = PlayerSchema.parse(moveData);
      const player = players.get(socket.id);
      
      if (player) {
        // Update position
        player.position = parsedData.position;
        
        // Update rotation if provided
        if (parsedData.rotation) {
          player.rotation = parsedData.rotation;
        }
        
        io.emit('playerMoved', player);
      }
    } catch (error) {
      console.error('Invalid movement data:', error);
    }
  });

  // Handle disconnection - free up the color when player leaves
  socket.on('disconnect', () => {
    if (players.has(socket.id)) {
      const player = players.get(socket.id);
      if (player.color) {
        usedColors.delete(player.color);
      }
      
      players.delete(socket.id);
      io.emit('playerLeft', socket.id);
      console.log(`Player ${socket.id} left the game`);
    }
  });

  // Add projectile handling to server
  socket.on('shootProjectile', (projectileData) => {
    // Add shooter ID to the data
    projectileData.shooter = socket.id;
    
    // Broadcast projectile to all other clients
    socket.broadcast.emit('projectileShot', projectileData);
  });

  socket.on('playerHit', (hitData) => {
    // Broadcast the hit to all clients
    io.emit('playerHit', hitData);
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 