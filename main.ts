import * as THREE from 'three';
import { io, Socket } from 'socket.io-client';
import { z } from 'zod';

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
  color: z.string(),
});

type Player = z.infer<typeof PlayerSchema>;

// Game settings
const TANK_SIZE = { width: 90, height: 60, depth: 90 };
const MOVEMENT_SPEED = 0.01; // Halved movement speed
const MOUSE_SENSITIVITY = 0.001;
const FRICTION = 0.9; // Friction coefficient for movement (0-1)
const MAX_VELOCITY = 0.2; // Maximum velocity cap

// Preset colors for number key shortcuts
const PRESET_COLORS = {
  1: '#ff6b6b', // Red
  2: '#4d96ff', // Blue
  3: '#70cc49', // Green
  4: '#ffcc29', // Yellow
  5: '#c882e0', // Purple
  6: '#ff8e4f', // Orange
  7: '#4ecdc4', // Teal
  8: '#ff80bf', // Pink
  9: '#a2d2ff'  // Light blue
};

// Soft watercolor palette
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
  '#ebf2ee'  // softer sage
];

// Mouse control variables
let mouseX = 0;
let mouseY = 0;
let targetRotationX = 0;
let targetRotationY = 0;
let isPointerLocked = false;

// Three.js setup
const scene = new THREE.Scene();
// Light blue-white background
scene.background = new THREE.Color(0xeef5ff);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Improved texture loading with error handling
const textureLoader = new THREE.TextureLoader();
let smileyTexture: THREE.Texture;

// More verbose logging for debugging
console.log('Attempting to load smiley texture...');

// Try different possible locations for the smiley image
const possiblePaths = [
  'smiley.png',
  './smiley.png',
  '/smiley.png',
  '../smiley.png',
  'dist/smiley.png'
];

// Function to try next path or use fallback
function tryNextPath(pathIndex = 0) {
  if (pathIndex >= possiblePaths.length) {
    console.error('Failed to load smiley texture from all paths, using fallback');
    smileyTexture = createFallbackSmileyTexture();
    initGame();
    return;
  }

  console.log(`Trying to load texture from: ${possiblePaths[pathIndex]}`);
  
  textureLoader.load(
    possiblePaths[pathIndex],
    (texture) => {
      console.log(`Successfully loaded smiley texture from: ${possiblePaths[pathIndex]}`);
      smileyTexture = texture;
      initGame();
    },
    (progress) => {
      console.log(`Loading progress: ${Math.round(progress.loaded / progress.total * 100)}%`);
    },
    (error) => {
      console.warn(`Failed to load from ${possiblePaths[pathIndex]}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      tryNextPath(pathIndex + 1);
    }
  );
}

// Start trying to load the texture
tryNextPath();

// Create a fallback texture with transparency for the face only
const createFallbackSmileyTexture = () => {
  console.log('Creating fallback smiley texture');
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d')!;
  
  // Start with a completely transparent canvas
  context.clearRect(0, 0, 512, 512);
  
  // Draw eyes
  context.fillStyle = '#000000';
  context.beginPath();
  context.arc(180, 180, 25, 0, Math.PI * 2);
  context.arc(332, 180, 25, 0, Math.PI * 2);
  context.fill();
  
  // Draw smile
  context.beginPath();
  context.arc(256, 256, 120, 0.2, Math.PI - 0.2);
  context.lineWidth = 15;
  context.strokeStyle = '#000000';
  context.stroke();
  
  console.log('Fallback texture created with face features only');
  return new THREE.CanvasTexture(canvas);
};

// Create fish tank
const createFishTank = () => {
  const tankGeometry = new THREE.BoxGeometry(
    TANK_SIZE.width,
    TANK_SIZE.height,
    TANK_SIZE.depth
  );
  const tankMaterial = new THREE.MeshBasicMaterial({
    color: 0xb3d9ff,
    transparent: true,
    opacity: 0.2,
    wireframe: true
  });
  const tank = new THREE.Mesh(tankGeometry, tankMaterial);
  scene.add(tank);

  // Add water base
  const baseGeometry = new THREE.PlaneGeometry(TANK_SIZE.width, TANK_SIZE.depth);
  const baseMaterial = new THREE.MeshBasicMaterial({
    color: 0xccebff,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.rotation.x = Math.PI / 2;
  base.position.y = -TANK_SIZE.height / 2;
  scene.add(base);

  // Add some decorations
  const decorGeometry = new THREE.ConeGeometry(1, 2, 8);
  const decorMaterial = new THREE.MeshBasicMaterial({ color: 0x8dd3c7 });
  
  for (let i = 0; i < 5; i++) {
    const decor = new THREE.Mesh(decorGeometry, decorMaterial);
    decor.position.set(
      Math.random() * TANK_SIZE.width - TANK_SIZE.width / 2,
      -TANK_SIZE.height / 2 + 1,
      Math.random() * TANK_SIZE.depth - TANK_SIZE.depth / 2
    );
    scene.add(decor);
  }
};

// Player management
const players: Map<string, THREE.Mesh> = new Map();
const localPlayer = {
  id: '',
  mesh: null as THREE.Mesh | null,
  velocity: new THREE.Vector3(0, 0, 0),
  acceleration: new THREE.Vector3(0, 0, 0)
};

// Add view mode settings
const VIEW_MODES = {
  FIRST_PERSON: 'first-person',
  THIRD_PERSON: 'third-person'
};
let currentViewMode = VIEW_MODES.FIRST_PERSON;
const THIRD_PERSON_DISTANCE = 5; // Distance behind player in third-person mode
const THIRD_PERSON_HEIGHT = 2;   // Height above player in third-person mode

// Create player sphere with colored background and smiley face
const createPlayerSphere = (player: Player, isLocalPlayer = false): THREE.Mesh => {
  const geometry = new THREE.SphereGeometry(1, 32, 32);
  
  console.log(`Creating player sphere with texture: ${smileyTexture ? 'loaded' : 'missing'}`);
  
  // Adjust UVs for the texture
  if (!smileyTexture.image.src) { // It's our canvas texture
    console.log('Using default UVs for fallback texture');
  } else {
    console.log('Modifying UVs for loaded texture');
    const uvs = geometry.attributes.uv.array;
    for (let i = 0; i < uvs.length; i += 2) {
      // Scale UVs to make the face smaller (around 20% of the original size)
      uvs[i] = (uvs[i] - 0.2) * 0.2 + 0.2;
      uvs[i+1] = (uvs[i+1] - 0.2) * 0.2 + 0.2;
    }
    geometry.attributes.uv.needsUpdate = true;
  }
  
  // Create a sphere with the watercolor hue as the base color
  const material = new THREE.MeshBasicMaterial({
    color: player.color,
    transparent: true,
    opacity: 0.9
  });
  
  const sphere = new THREE.Mesh(geometry, material);
  
  // Add a second material layer with just the smiley face
  const faceMaterial = new THREE.MeshBasicMaterial({
    map: smileyTexture,
    transparent: true,
    depthWrite: false,
    opacity: 1.0
  });
  
  // Create a slightly larger face layer
  const faceGeometry = new THREE.SphereGeometry(1.01, 32, 32);
  const faceSphere = new THREE.Mesh(faceGeometry, faceMaterial);
  
  // Add the face as a child of the colored sphere
  sphere.add(faceSphere);
  
  // Make other players slightly larger for better visibility
  if (!isLocalPlayer) {
    sphere.scale.set(1.2, 1.2, 1.2);
  }
  
  // Position and rotate
  sphere.position.set(player.position.x, player.position.y, player.position.z);
  
  // Set initial rotation if provided
  if (player.rotation) {
    sphere.rotation.x = player.rotation.x;
    sphere.rotation.y = player.rotation.y;
  }
  
  // Set userData for player identification
  sphere.userData.isPlayer = true;
  sphere.userData.isLocalPlayer = isLocalPlayer;
  sphere.userData.id = player.id;
  sphere.userData.lastDirection = new THREE.Vector3();
  
  // Add transparent flag to userData for easier updates
  sphere.userData.originalOpacity = 0.9;
  
  scene.add(sphere);
  console.log(`Player sphere created: ${player.id}, local: ${isLocalPlayer}`);
  return sphere;
};

// Socket.io setup - connect to same origin with fallback
const socket: Socket = (() => {
  // During development with webpack-dev-server
  if (process.env.NODE_ENV === 'development') {
    return io();
  }
  // Production
  return io();
})();

// Initialize socket events outside of the initGame function
socket.on('connect', () => {
  console.log('Connected to server with ID:', socket.id);
  
  // Only emit joinGame when we're ready (after textures are loaded)
  if (smileyTexture) {
    joinGame();
  }
});

// Function to join the game
function joinGame() {
  localPlayer.id = socket.id ?? '';
  
  // Join the game with a random watercolor color
  const randomColor = WATERCOLOR_PALETTE[Math.floor(Math.random() * WATERCOLOR_PALETTE.length)];
  
  socket.emit('joinGame', {
    id: socket.id,
    position: { x: 0, y: 0, z: 0 },
    color: randomColor
  });
  
  console.log('Joining game with ID:', localPlayer.id);
}

socket.on('playerJoined', (player: Player) => {
  console.log('Player joined:', player.id, player);
  
  if (player.id === localPlayer.id) {
    // Create local player
    localPlayer.mesh = createPlayerSphere(player, true);
    camera.position.set(0, 0, 0);
  } else {
    // Create other player
    const otherPlayerMesh = createPlayerSphere(player, false);
    players.set(player.id, otherPlayerMesh);
    console.log('Other player added, total players:', players.size);
  }
});

// Initialize the game once textures are loaded
const initGame = () => {
  console.log('Initializing game...');
  createFishTank();
  
  // If we're already connected, join the game
  if (socket.connected) {
    joinGame();
  }
  
  // Start animation loop
  animate();
};

socket.on('playerMoved', (player: Player) => {
  if (player.id !== localPlayer.id) {
    const playerMesh = players.get(player.id);
    if (playerMesh) {
      // Update position
      playerMesh.position.set(player.position.x, player.position.y, player.position.z);
      
      // Update rotation if provided
      if (player.rotation) {
        playerMesh.rotation.y = player.rotation.y;
        
        // Store the last known movement direction
        if (playerMesh.userData.lastPosition) {
          const direction = new THREE.Vector3()
            .subVectors(playerMesh.position, playerMesh.userData.lastPosition);
          if (direction.length() > 0.01) { // Only update if there's significant movement
            playerMesh.userData.lastDirection.copy(direction.normalize());
          }
        }
        
        // Store current position for next comparison
        playerMesh.userData.lastPosition = playerMesh.position.clone();
      }
    } else {
      console.warn('Received movement for unknown player:', player.id);
    }
  }
});

socket.on('playerLeft', (playerId: string) => {
  const playerMesh = players.get(playerId);
  if (playerMesh) {
    scene.remove(playerMesh);
    players.delete(playerId);
  }
});

// Input handling
const keys = {
  w: false,
  a: false,
  s: false,
  d: false
};

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() in keys) {
    keys[e.key.toLowerCase() as keyof typeof keys] = true;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() in keys) {
    keys[e.key.toLowerCase() as keyof typeof keys] = false;
  }
});

// Mouse controls for camera rotation
document.addEventListener('click', () => {
  if (!isPointerLocked) {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === renderer.domElement;
});

// Mouse controls for camera rotation with improved stability
document.addEventListener('mousemove', (event) => {
  if (isPointerLocked) {
    // Get raw mouse movement
    mouseX = event.movementX || 0;
    mouseY = event.movementY || 0;
    
    // Apply horizontal rotation normally
    targetRotationY -= mouseX * MOUSE_SENSITIVITY;
    
    // For vertical movement:
    // 1. Reduce sensitivity significantly
    // 2. Add a dead zone to ignore small movements
    const VERTICAL_SENSITIVITY_REDUCTION = 0.6; // Only 60% as sensitive as horizontal
    const DEAD_ZONE = 1.5; // Ignore movements smaller than this
    
    if (Math.abs(mouseY) > DEAD_ZONE) {
      // Apply reduced sensitivity to vertical movement
      targetRotationX -= mouseY * MOUSE_SENSITIVITY * VERTICAL_SENSITIVITY_REDUCTION;
    }
    
    // Limit vertical rotation to prevent flipping
    targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, targetRotationX));
  }
});

// Update local player movement with physics
const updateMovement = () => {
  console.log("Updating movement...");
  if (!localPlayer.mesh) {
    console.warn('Movement update called but local player mesh is not initialized');
    return;
  }
  
  // Reset acceleration for this frame
  localPlayer.acceleration.set(0, 0, 0);
  
  // Calculate movement directions based on both camera X and Y rotation
  // This is needed for proper 3D movement including vertical component
  
  // Forward vector - points where the camera is looking (including up/down)
  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyEuler(new THREE.Euler(targetRotationX, targetRotationY, 0, 'YXZ'));
  
  // Right vector - always stays horizontal regardless of where you're looking
  const right = new THREE.Vector3(1, 0, 0);
  right.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetRotationY);
  
  // Calculate acceleration based on input and camera orientation
  if (keys.w) {
    localPlayer.acceleration.add(forward.clone().multiplyScalar(MOVEMENT_SPEED));
  }
  
  if (keys.s) {
    localPlayer.acceleration.add(forward.clone().multiplyScalar(-MOVEMENT_SPEED));
  }
  
  if (keys.a) {
    localPlayer.acceleration.add(right.clone().multiplyScalar(-MOVEMENT_SPEED));
  }
  
  if (keys.d) {
    localPlayer.acceleration.add(right.clone().multiplyScalar(MOVEMENT_SPEED));
  }
  
  // Apply acceleration to velocity
  localPlayer.velocity.add(localPlayer.acceleration);
  
  // Apply friction
  localPlayer.velocity.multiplyScalar(FRICTION);
  
  // Limit maximum velocity
  if (localPlayer.velocity.length() > MAX_VELOCITY) {
    localPlayer.velocity.normalize().multiplyScalar(MAX_VELOCITY);
  }
  
  // Apply velocity to position
  localPlayer.mesh.position.add(localPlayer.velocity);
  
  // Check boundaries and bounce
  const halfWidth = TANK_SIZE.width / 2 - 1;
  const halfHeight = TANK_SIZE.height / 2 - 1;
  const halfDepth = TANK_SIZE.depth / 2 - 1;
  
  if (localPlayer.mesh.position.x > halfWidth) {
    localPlayer.mesh.position.x = halfWidth;
    localPlayer.velocity.x *= -0.5; // Bounce with damping
  } else if (localPlayer.mesh.position.x < -halfWidth) {
    localPlayer.mesh.position.x = -halfWidth;
    localPlayer.velocity.x *= -0.5;
  }
  
  if (localPlayer.mesh.position.y > halfHeight) {
    localPlayer.mesh.position.y = halfHeight;
    localPlayer.velocity.y *= -0.5;
  } else if (localPlayer.mesh.position.y < -halfHeight) {
    localPlayer.mesh.position.y = -halfHeight;
    localPlayer.velocity.y *= -0.5;
  }
  
  if (localPlayer.mesh.position.z > halfDepth) {
    localPlayer.mesh.position.z = halfDepth;
    localPlayer.velocity.z *= -0.5;
  } else if (localPlayer.mesh.position.z < -halfDepth) {
    localPlayer.mesh.position.z = -halfDepth;
    localPlayer.velocity.z *= -0.5;
  }
  
  // Make the player mesh face the camera direction
  localPlayer.mesh.rotation.y = targetRotationY;
  
  // Update camera position
  if (currentViewMode === VIEW_MODES.FIRST_PERSON) {
    // First-person: position camera at player position
    camera.position.copy(localPlayer.mesh.position);
  } else {
    // Third-person: position camera behind player
    const cameraOffset = new THREE.Vector3(0, THIRD_PERSON_HEIGHT, THIRD_PERSON_DISTANCE);
    cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetRotationY);
    camera.position.copy(localPlayer.mesh.position).add(cameraOffset);
  }
  
  // Set camera rotation
  camera.rotation.x = targetRotationX;
  camera.rotation.y = targetRotationY;
  
  // Add before sending to server:
  console.log("Emitting movement:", {
    id: localPlayer.id,
    position: {
      x: localPlayer.mesh.position.x,
      y: localPlayer.mesh.position.y,
      z: localPlayer.mesh.position.z
    }
  });
  
  socket.emit('movePlayer', {
    id: localPlayer.id,
    position: {
      x: localPlayer.mesh.position.x,
      y: localPlayer.mesh.position.y,
      z: localPlayer.mesh.position.z
    },
    rotation: {
      x: targetRotationX,
      y: targetRotationY
    }
  });
};

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Update the sphere facing logic to use movement direction
const updateSphereFacings = () => {
  players.forEach((playerMesh, id) => {
    // Make sure the other players' spheres are visible
    if (!scene.children.includes(playerMesh)) {
      console.warn(`Re-adding player ${id} to scene`);
      scene.add(playerMesh);
    }
    
    // Add a debug sphere if enabled
    if (debugMode && !playerMesh.userData.hasDebugSphere) {
      const debugGeometry = new THREE.SphereGeometry(0.2, 8, 8);
      const debugMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xff0000,
        wireframe: true
      });
      const debugSphere = new THREE.Mesh(debugGeometry, debugMaterial);
      playerMesh.add(debugSphere);
      playerMesh.userData.hasDebugSphere = true;
    }
    
    // We don't need to make other players face the camera anymore
    // Their rotation is now controlled by the server updates
  });
  
  // Debug output
  if (players.size > 0 && Math.random() < 0.01) {
    console.log(`Number of other players: ${players.size}`);
  }
};

// Add a debug mode toggle
let debugMode = false;
document.addEventListener('keydown', (event) => {
  if (event.key === 'F3') {
    debugMode = !debugMode;
    console.log(`Debug mode: ${debugMode ? 'ON' : 'OFF'}`);
  }
  
  if (event.key.toLowerCase() === 'p') {
    toggleViewMode();
  }
});

// Function to toggle between first and third person views
function toggleViewMode() {
  currentViewMode = currentViewMode === VIEW_MODES.FIRST_PERSON 
    ? VIEW_MODES.THIRD_PERSON 
    : VIEW_MODES.FIRST_PERSON;
  
  console.log(`View mode switched to: ${currentViewMode}`);
}

// Projectile system
interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  shooter: string; // Player ID who shot this
  shooterColor: string; // Color of shooter
  timeCreated: number;
  lifespan: number; // How long it lives in ms
}

const projectiles: Projectile[] = [];
const PROJECTILE_SPEED = 0.3;
const PROJECTILE_LIFESPAN = 5000; // 5 seconds
const PROJECTILE_COOLDOWN = 50; // Reduced from 500ms to 50ms for much faster shooting
let lastShotTime = 0;

// Function to create a heart emoji projectile
function createHeartProjectile(position: THREE.Vector3, direction: THREE.Vector3, shooterId: string, color: string): Projectile {
  // Create heart shape using TextGeometry or use a sprite
  const heartGeometry = new THREE.SphereGeometry(0.3, 8, 8);
  const heartMaterial = new THREE.MeshBasicMaterial({ 
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.8
  });
  
  const heartMesh = new THREE.Mesh(heartGeometry, heartMaterial);
  
  // Create heart sprite with emoji
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  
  // Clear background
  context.clearRect(0, 0, 64, 64);
  
  // Draw heart
  context.font = '40px Arial';
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('♥', 32, 32);
  
  const heartTexture = new THREE.CanvasTexture(canvas);
  
  // Create sprite
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ 
      map: heartTexture,
      transparent: true,
      depthTest: true
    })
  );
  sprite.scale.set(0.8, 0.8, 0.8);
  
  // Add sprite to heart mesh
  heartMesh.add(sprite);
  heartMesh.position.copy(position);
  
  // Add slight offset in shoot direction to prevent self-collision
  heartMesh.position.add(direction.clone().multiplyScalar(1.2));
  
  scene.add(heartMesh);
  
  return {
    mesh: heartMesh,
    velocity: direction.normalize().multiplyScalar(PROJECTILE_SPEED),
    shooter: shooterId,
    shooterColor: color,
    timeCreated: Date.now(),
    lifespan: PROJECTILE_LIFESPAN
  };
}

// Function to shoot a projectile
function shootProjectile() {
  const now = Date.now();
  
  // Check cooldown
  if (now - lastShotTime < PROJECTILE_COOLDOWN) {
    return;
  }
  
  lastShotTime = now;
  
  if (!localPlayer.mesh) return;
  
  // Calculate shooting direction
  let direction = new THREE.Vector3(0, 0, -1);
  
  if (currentViewMode === VIEW_MODES.FIRST_PERSON) {
    // In first-person, use camera orientation directly
    direction.applyQuaternion(camera.quaternion);
  } else {
    // In third-person, shoot from player toward camera target
    // First get the forward direction of the player
    direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(localPlayer.mesh.quaternion);
    
    // Adjust for pitch (up/down aim) from camera
    const pitchMatrix = new THREE.Matrix4().makeRotationX(targetRotationX);
    direction.applyMatrix4(pitchMatrix);
  }
  
  // Get player color
  const material = localPlayer.mesh.material as THREE.MeshBasicMaterial;
  const color = material.color.getHexString();
  
  // Create projectile
  const projectile = createHeartProjectile(
    localPlayer.mesh.position.clone(),
    direction,
    localPlayer.id,
    `#${color}`
  );
  
  projectiles.push(projectile);
  
  // Emit to server
  socket.emit('shootProjectile', {
    position: {
      x: projectile.mesh.position.x,
      y: projectile.mesh.position.y,
      z: projectile.mesh.position.z
    },
    direction: {
      x: direction.x,
      y: direction.y,
      z: direction.z
    },
    color: `#${color}`
  });
}

// Function to mix two colors
function mixColors(color1: string, color2: string): string {
  const c1 = new THREE.Color(color1);
  const c2 = new THREE.Color(color2);
  
  // Mix colors by averaging RGB values
  const mixed = new THREE.Color(
    (c1.r + c2.r) / 2,
    (c1.g + c2.g) / 2,
    (c1.b + c2.b) / 2
  );
  
  return `#${mixed.getHexString()}`;
}

// Update projectiles and check collisions
function updateProjectiles() {
  const now = Date.now();
  
  // Update each projectile
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const projectile = projectiles[i];
    
    // Check lifespan
    if (now - projectile.timeCreated > projectile.lifespan) {
      // Remove expired projectile
      scene.remove(projectile.mesh);
      projectiles.splice(i, 1);
      continue;
    }
    
    // Move projectile
    projectile.mesh.position.add(projectile.velocity);
    
    // Check for collisions with other players - using Array.from and for...of instead of forEach
    let hasCollided = false;
    for (const [playerId, playerMesh] of Array.from(players.entries())) {
      // Skip if this is the shooter
      if (playerId === projectile.shooter) continue;
      
      // Calculate distance between projectile and player
      const distance = projectile.mesh.position.distanceTo(playerMesh.position);
      
      // If collision detected
      if (distance < 1.5) { // Adjusted for player sphere size + projectile
        // Mix colors
        const playerMaterial = playerMesh.material as THREE.MeshBasicMaterial;
        const playerColor = `#${playerMaterial.color.getHexString()}`;
        const newColor = mixColors(playerColor, projectile.shooterColor);
        
        // Update player color
        playerMaterial.color.set(newColor);
        
        // Emit color change
        socket.emit('playerHit', {
          playerId: playerId,
          newColor: newColor
        });
        
        // Remove projectile
        scene.remove(projectile.mesh);
        projectiles.splice(i, 1);
        
        // Show hit effect
        createHitEffect(playerMesh.position.clone());
        
        // Mark as collided and break out of the loop
        hasCollided = true;
        break; // This is now valid as we're in a regular for loop
      }
    }
    
    // If we've already handled a collision, continue to the next projectile
    if (hasCollided) continue;
    
    // Check boundaries
    const halfWidth = TANK_SIZE.width / 2 - 0.5;
    const halfHeight = TANK_SIZE.height / 2 - 0.5;
    const halfDepth = TANK_SIZE.depth / 2 - 0.5;
    
    if (
      projectile.mesh.position.x > halfWidth ||
      projectile.mesh.position.x < -halfWidth ||
      projectile.mesh.position.y > halfHeight ||
      projectile.mesh.position.y < -halfHeight ||
      projectile.mesh.position.z > halfDepth ||
      projectile.mesh.position.z < -halfDepth
    ) {
      // Remove projectile that hit the boundary
      scene.remove(projectile.mesh);
      projectiles.splice(i, 1);
    }
  }
}

// Create a visual hit effect
function createHitEffect(position: THREE.Vector3) {
  // Create a burst of small hearts
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const canvasSize = 32;
    
    // Create mini heart sprite
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const context = canvas.getContext('2d')!;
    
    context.clearRect(0, 0, canvasSize, canvasSize);
    context.font = '20px Arial';
    context.fillStyle = `hsl(${Math.random() * 360}, 100%, 75%)`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('♥', canvasSize/2, canvasSize/2);
    
    const heartTexture = new THREE.CanvasTexture(canvas);
    
    // Create sprite
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: heartTexture,
        transparent: true
      })
    );
    
    sprite.scale.set(0.5, 0.5, 0.5);
    sprite.position.copy(position);
    
    // Add random velocity
    const velocity = new THREE.Vector3(
      Math.cos(angle) * 0.03 + (Math.random() - 0.5) * 0.02,
      Math.random() * 0.05,
      Math.sin(angle) * 0.03 + (Math.random() - 0.5) * 0.02
    );
    
    scene.add(sprite);
    
    // Animate and remove
    const startTime = Date.now();
    const animateParticle = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > 1000) {
        scene.remove(sprite);
        return;
      }
      
      sprite.position.add(velocity);
      velocity.y -= 0.001; // Gravity
      
      // Fade out
      sprite.material.opacity = 1 - (elapsed / 1000);
      
      requestAnimationFrame(animateParticle);
    };
    
    animateParticle();
  }
}

// Add socket events for projectiles
socket.on('projectileShot', (data: any) => {
  if (data.shooter === localPlayer.id) return; // Skip our own projectiles
  
  const position = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
  const direction = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z);
  
  projectiles.push(createHeartProjectile(
    position,
    direction,
    data.shooter,
    data.color
  ));
});

socket.on('playerHit', (data: any) => {
  if (data.playerId === localPlayer.id) {
    // We got hit, update our color
    if (localPlayer.mesh) {
      const material = localPlayer.mesh.material as THREE.MeshBasicMaterial;
      material.color.set(data.newColor);
    }
  } else {
    // Another player got hit
    const playerMesh = players.get(data.playerId);
    if (playerMesh) {
      const material = playerMesh.material as THREE.MeshBasicMaterial;
      material.color.set(data.newColor);
    }
  }
});

// Add mouse click handler for shooting
document.addEventListener('mousedown', (event) => {
  if (event.button === 0) { // Left click
    shootProjectile();
  }
});

// Update animation loop to include projectile updates
function animate() {
  requestAnimationFrame(animate);
  updateMovement();
  updateProjectiles();
  updateSphereFacings();
  renderer.render(scene, camera);
}

animate();

// Add number key handlers for color changing
document.addEventListener('keydown', (event) => {
  // Check if the key is a number from 1-9
  const keyNum = parseInt(event.key);
  
  if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 9 && localPlayer.mesh) {
    // Change to the preset color
    const newColor = PRESET_COLORS[keyNum as keyof typeof PRESET_COLORS];
    
    // Update local player color
    const material = localPlayer.mesh.material as THREE.MeshBasicMaterial;
    material.color.set(newColor);
    
    // Tell the server about the color change
    socket.emit('changeColor', {
      id: localPlayer.id,
      color: newColor
    });
    
    console.log(`Changed color to ${newColor}`);
  }
});

// Listen for other players changing colors
socket.on('playerColorChanged', (data) => {
  // Skip if it's our own update
  if (data.id === localPlayer.id) return;
  
  const playerMesh = players.get(data.id);
  if (playerMesh) {
    const material = playerMesh.material as THREE.MeshBasicMaterial;
    material.color.set(data.color);
  }
});
