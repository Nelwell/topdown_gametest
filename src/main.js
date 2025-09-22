const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const VIEW_WIDTH = canvas.width;
const VIEW_HEIGHT = canvas.height;
const TILE_SIZE = 16;
const HALF_TILE = TILE_SIZE / 2;
const STORAGE_KEY = 'topdown-legend-save';

const inputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  attack: false,
  interact: false,
  dash: false
};

const justPressed = {
  attack: false,
  interact: false,
  dash: false
};

let lastTimestamp = 0;

const gameState = {
  currentMap: null,
  maps: new Map(),
  player: null,
  enemies: [],
  projectiles: [],
  particles: [],
  effects: [],
  hudMessage: '',
  hudTimer: 0,
  prompt: '',
  currentRegion: null,
  areaName: 'Verdant Kingdom',
  objectiveText: 'Explore the land and uncover the lost temples.',
  areaRevealTimer: 0,
  flags: {
    forestBossDefeated: false,
    emberBossDefeated: false,
    frostBossDefeated: false
  },
  lastSave: null
};

const keys = new Map([
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
  ['KeyW', 'up'],
  ['KeyS', 'down'],
  ['KeyA', 'left'],
  ['KeyD', 'right'],
  ['KeyJ', 'attack'],
  ['Space', 'attack'],
  ['KeyK', 'interact'],
  ['Enter', 'interact'],
  ['ShiftLeft', 'dash'],
  ['ShiftRight', 'dash']
]);

window.addEventListener('keydown', (event) => {
  const action = keys.get(event.code);
  if (!action) return;
  if (['attack', 'interact', 'dash'].includes(action) && !inputState[action]) {
    justPressed[action] = true;
  }
  inputState[action] = true;
  event.preventDefault();
});

window.addEventListener('keyup', (event) => {
  const action = keys.get(event.code);
  if (!action) return;
  inputState[action] = false;
});

const uiLife = document.getElementById('life');
const uiStatus = document.getElementById('status');
const uiAreaName = document.getElementById('area-name');
const uiObjective = document.getElementById('objective');

const camera = {
  x: 0,
  y: 0,
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(seed) {
  let t = seed += 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function seededRandom(x, y, seed = 1337) {
  return rand(x * 374761393 + y * 668265263 + seed * 982451653);
}

function createCanvas(size = TILE_SIZE, height = size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  return c;
}

function scatterPixels(context, color, count, seedOffset = 0, alpha = 1) {
  const imageData = context.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  const data = imageData.data;
  const [r, g, b] = hexToRgb(color);
  let seed = seedOffset;
  for (let i = 0; i < count; i++) {
    seed += 1;
    const px = Math.floor(rand(seed) * TILE_SIZE);
    seed += 1;
    const py = Math.floor(rand(seed) * TILE_SIZE);
    const idx = (py * TILE_SIZE + px) * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = Math.floor(alpha * 255);
  }
  context.putImageData(imageData, 0, 0);
}

function hexToRgb(hex) {
  const parsed = hex.replace('#', '');
  const bigint = parseInt(parsed, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function drawTileBorder(ctx, color, thickness = 1, inset = 0) {
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.strokeRect(inset + 0.5, inset + 0.5, TILE_SIZE - inset * 2 - 1, TILE_SIZE - inset * 2 - 1);
}

function createTileType(isSolid, variants) {
  return { isSolid, variants };
}

function getVariant(tileType, x, y) {
  if (!tileType || tileType.variants.length === 0) return null;
  const index = Math.abs(((x * 928371 + y * 523421) ^ (x + y)) % tileType.variants.length);
  return tileType.variants[index];
}
function paintGrass(base, highlight, shadow, seedShift = 0) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  scatterPixels(context, highlight, 22, seedShift + 1, 0.85);
  scatterPixels(context, shadow, 14, seedShift + 77, 0.85);
  return canvas;
}

function paintFloweredGrass(base, highlight, shadow, flower) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  scatterPixels(context, highlight, 18, 31, 0.9);
  scatterPixels(context, shadow, 10, 73, 0.8);
  scatterPixels(context, flower, 4, 101, 1);
  return canvas;
}

function paintPath(base, rim, cracks = '#775632') {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, TILE_SIZE, TILE_SIZE);
  gradient.addColorStop(0, rim);
  gradient.addColorStop(1, base);
  context.fillStyle = gradient;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = cracks;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(2, TILE_SIZE - 4);
  context.lineTo(TILE_SIZE - 3, 3);
  context.stroke();
  context.beginPath();
  context.moveTo(3, TILE_SIZE / 2);
  context.lineTo(TILE_SIZE - 4, TILE_SIZE / 2 + 2);
  context.stroke();
  drawTileBorder(context, 'rgba(56, 34, 12, 0.35)', 1);
  return canvas;
}

function paintWater(top, bottom, foam = '#b3ecff') {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, TILE_SIZE);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = foam;
  context.lineWidth = 1;
  context.globalAlpha = 0.4;
  for (let i = 0; i < 3; i++) {
    context.beginPath();
    context.arc(4 + i * 4, 4 + i, 3, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;
  return canvas;
}

function paintMountain(base, top, shadow) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.fillStyle = shadow;
  context.beginPath();
  context.moveTo(0, TILE_SIZE);
  context.lineTo(TILE_SIZE / 2, 4);
  context.lineTo(TILE_SIZE, TILE_SIZE);
  context.closePath();
  context.fill();
  context.fillStyle = top;
  context.beginPath();
  context.moveTo(TILE_SIZE / 2, 4);
  context.lineTo(TILE_SIZE / 2 + 4, 10);
  context.lineTo(TILE_SIZE / 2 - 4, 10);
  context.closePath();
  context.fill();
  drawTileBorder(context, 'rgba(0, 0, 0, 0.35)');
  return canvas;
}

function paintSand(base, highlight, ripple) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = highlight;
  context.globalAlpha = 0.6;
  context.beginPath();
  context.moveTo(0, TILE_SIZE - 6);
  context.quadraticCurveTo(TILE_SIZE / 2, TILE_SIZE - 10, TILE_SIZE, TILE_SIZE - 6);
  context.stroke();
  context.beginPath();
  context.moveTo(0, TILE_SIZE - 2);
  context.quadraticCurveTo(TILE_SIZE / 2, TILE_SIZE - 5, TILE_SIZE, TILE_SIZE - 1);
  context.stroke();
  context.globalAlpha = 1;
  scatterPixels(context, ripple, 12, 80, 0.9);
  return canvas;
}

function paintSnow(base, shade, sparkle) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  scatterPixels(context, shade, 10, 21, 0.6);
  scatterPixels(context, sparkle, 6, 45, 0.9);
  drawTileBorder(context, 'rgba(255, 255, 255, 0.2)');
  return canvas;
}

function paintDungeonFloor(base, cracks, glow) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = cracks;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(2, 2);
  context.lineTo(TILE_SIZE - 3, TILE_SIZE - 3);
  context.moveTo(2, TILE_SIZE - 3);
  context.lineTo(TILE_SIZE - 4, 3);
  context.stroke();
  context.globalAlpha = 0.7;
  context.fillStyle = glow;
  context.fillRect(TILE_SIZE / 2 - 2, TILE_SIZE / 2 - 2, 4, 4);
  context.globalAlpha = 1;
  return canvas;
}

function paintDungeonWall(base, edge, highlight) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, TILE_SIZE, TILE_SIZE);
  gradient.addColorStop(0, base);
  gradient.addColorStop(1, highlight);
  context.fillStyle = gradient;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  drawTileBorder(context, edge, 2, 1);
  return canvas;
}

function paintLava(base, molten, cracks) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(
    TILE_SIZE / 2,
    TILE_SIZE / 2,
    2,
    TILE_SIZE / 2,
    TILE_SIZE / 2,
    TILE_SIZE / 2
  );
  gradient.addColorStop(0, molten);
  gradient.addColorStop(1, base);
  context.fillStyle = gradient;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = cracks;
  context.lineWidth = 1.2;
  context.globalAlpha = 0.7;
  context.beginPath();
  context.moveTo(1, TILE_SIZE / 2);
  context.bezierCurveTo(
    TILE_SIZE / 4,
    TILE_SIZE / 2 - 4,
    TILE_SIZE / 2,
    TILE_SIZE / 2 + 4,
    TILE_SIZE - 2,
    TILE_SIZE / 2
  );
  context.stroke();
  context.globalAlpha = 1;
  return canvas;
}

function paintRuneCircle(base, rune, halo) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.fillStyle = halo;
  context.globalAlpha = 0.4;
  context.beginPath();
  context.arc(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2 - 1, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
  context.strokeStyle = rune;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2 - 2, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(TILE_SIZE / 2, 4);
  context.lineTo(TILE_SIZE / 2, TILE_SIZE - 4);
  context.moveTo(4, TILE_SIZE / 2);
  context.lineTo(TILE_SIZE - 4, TILE_SIZE / 2);
  context.stroke();
  return canvas;
}

function paintWoodPlanks(base, highlight) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = highlight;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, TILE_SIZE / 3);
  context.lineTo(TILE_SIZE, TILE_SIZE / 3);
  context.moveTo(0, (2 * TILE_SIZE) / 3);
  context.lineTo(TILE_SIZE, (2 * TILE_SIZE) / 3);
  context.stroke();
  context.beginPath();
  context.moveTo(TILE_SIZE / 2, 0);
  context.lineTo(TILE_SIZE / 2, TILE_SIZE);
  context.stroke();
  return canvas;
}

function paintCrystalFloor(base, shimmer) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = shimmer;
  context.globalAlpha = 0.8;
  context.beginPath();
  context.moveTo(2, 2);
  context.lineTo(TILE_SIZE - 2, TILE_SIZE - 2);
  context.moveTo(2, TILE_SIZE - 2);
  context.lineTo(TILE_SIZE - 2, 2);
  context.stroke();
  context.globalAlpha = 1;
  context.fillStyle = shimmer;
  context.fillRect(TILE_SIZE / 2 - 1, 3, 2, 4);
  context.fillRect(TILE_SIZE / 2 - 1, TILE_SIZE - 7, 2, 4);
  return canvas;
}

function paintCavernFloor(base, cracks) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = cracks;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(2, TILE_SIZE - 3);
  context.lineTo(TILE_SIZE - 3, 2);
  context.stroke();
  context.beginPath();
  context.moveTo(2, 2);
  context.lineTo(TILE_SIZE - 4, TILE_SIZE - 4);
  context.stroke();
  return canvas;
}

function paintCavernWall(base, shadow) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.fillStyle = shadow;
  context.beginPath();
  context.moveTo(0, TILE_SIZE);
  context.lineTo(TILE_SIZE / 2, TILE_SIZE / 2);
  context.lineTo(TILE_SIZE, TILE_SIZE);
  context.closePath();
  context.fill();
  drawTileBorder(context, 'rgba(0,0,0,0.45)', 1);
  return canvas;
}

function paintSaveTile(base, glow, glyph) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.fillStyle = glow;
  context.globalAlpha = 0.5;
  context.beginPath();
  context.arc(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2 - 1, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
  context.strokeStyle = glyph;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(TILE_SIZE / 2, 4);
  context.lineTo(TILE_SIZE / 2, TILE_SIZE - 4);
  context.moveTo(4, TILE_SIZE / 2);
  context.lineTo(TILE_SIZE - 4, TILE_SIZE / 2);
  context.stroke();
  return canvas;
}
const tileRegistry = {
  grass: createTileType(false, [paintGrass('#2f8e1f', '#46bf31', '#1f6612', 3)]),
  meadow: createTileType(false, [
    paintGrass('#329625', '#4fd53a', '#215f19', 11),
    paintGrass('#2f8e1f', '#3fa62c', '#1c5b12', 27)
  ]),
  flowers: createTileType(false, [
    paintFloweredGrass('#339022', '#3fb02b', '#1f6612', '#ffd966'),
    paintFloweredGrass('#339022', '#43b22f', '#1f6612', '#ff9ed6')
  ]),
  path: createTileType(false, [
    paintPath('#d1a360', '#9a6a36'),
    paintPath('#c69853', '#925927')
  ]),
  stone_path: createTileType(false, [paintDungeonFloor('#78726a', '#514a45', '#a89f8d')]),
  water: createTileType(true, [paintWater('#1a67a8', '#0c2a4f'), paintWater('#155a92', '#061d3c')]),
  shallow_water: createTileType(true, [paintWater('#2b8cc7', '#154a7a')]),
  mountain: createTileType(true, [paintMountain('#5b4636', '#f2f0db', '#3a2d24')]),
  cliff: createTileType(true, [paintMountain('#4d3a2d', '#d7c6a5', '#2d2119')]),
  sand: createTileType(false, [paintSand('#d9c075', '#f7e4a2', '#c6aa5b')]),
  dune: createTileType(false, [paintSand('#cfb164', '#f3d487', '#c79e46')]),
  desert_rock: createTileType(true, [paintMountain('#9a7a4f', '#f4d38a', '#7a5c33')]),
  snow: createTileType(false, [paintSnow('#f2fbff', '#c6d9e8', '#ffffff')]),
  snow_path: createTileType(false, [paintSnow('#dbe9f6', '#b3c3d8', '#f7ffff')]),
  frost_floor: createTileType(false, [paintCrystalFloor('#b6d1f8', '#f5fbff')]),
  frost_wall: createTileType(true, [paintDungeonWall('#7a8cb8', '#43527a', '#d7e3ff')]),
  swamp: createTileType(true, [paintWater('#2b4430', '#131f17', '#8abd66')]),
  planks: createTileType(false, [paintWoodPlanks('#895a2e', '#c6964e')]),
  temple_floor: createTileType(false, [paintDungeonFloor('#716659', '#4e4034', '#b3a690')]),
  temple_wall: createTileType(true, [paintDungeonWall('#3b3128', '#1b130d', '#65594a')]),
  dungeon_floor: createTileType(false, [paintDungeonFloor('#3c3945', '#1f1d26', '#5d5675')]),
  dungeon_wall: createTileType(true, [paintDungeonWall('#1e1928', '#0d0912', '#4b3e62')]),
  rune: createTileType(false, [paintRuneCircle('#3a2a4d', '#d3b66f', '#654a88')]),
  lava: createTileType(true, [paintLava('#a92918', '#ff7433', '#3b0404')]),
  obsidian: createTileType(false, [paintDungeonFloor('#2c1f26', '#130b0e', '#522936')]),
  cavern_floor: createTileType(false, [paintCavernFloor('#444046', '#1d1a20')]),
  cavern_wall: createTileType(true, [paintCavernWall('#30262f', '#1c151b')]),
  save_tile: createTileType(false, [paintSaveTile('#2f273d', '#78d0ff', '#d3f7ff')])
};

function createProp(width, height, painter, collisionBox = null) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  painter(context, width, height);
  return {
    width,
    height,
    image: canvas,
    collisionBox
  };
}

function shade(color, amount) {
  const [r, g, b] = hexToRgb(color);
  const mod = (channel) => clamp(Math.round(channel + channel * amount), 0, 255);
  const out = (mod(r) << 16) | (mod(g) << 8) | mod(b);
  return `#${out.toString(16).padStart(6, '0')}`;
}

const propLibrary = {
  tree: createProp(22, 28, (ctx, w, h) => {
    ctx.fillStyle = '#1d450f';
    ctx.fillRect(6, h - 10, 10, 10);
    const gradient = ctx.createRadialGradient(w / 2, 10, 6, w / 2, 14, 14);
    gradient.addColorStop(0, '#3fa829');
    gradient.addColorStop(1, '#1f5e13');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(w / 2, 12, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#52c13d';
    ctx.beginPath();
    ctx.arc(w / 2 - 5, 10, 4, 0, Math.PI * 2);
    ctx.arc(w / 2 + 5, 12, 3, 0, Math.PI * 2);
    ctx.fill();
  }, { x: 6, y: 18, width: 10, height: 10 }),
  pine: createProp(20, 28, (ctx, w, h) => {
    ctx.fillStyle = '#2d5531';
    ctx.fillRect(w / 2 - 3, h - 8, 6, 8);
    ctx.fillStyle = '#3c8a49';
    ctx.beginPath();
    ctx.moveTo(w / 2, 2);
    ctx.lineTo(w - 2, h - 8);
    ctx.lineTo(2, h - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#65c972';
    ctx.beginPath();
    ctx.moveTo(w / 2, 6);
    ctx.lineTo(w - 4, h - 12);
    ctx.lineTo(4, h - 12);
    ctx.closePath();
    ctx.fill();
  }, { x: 6, y: 18, width: 8, height: 8 }),
  cactus: createProp(20, 26, (ctx, w, h) => {
    ctx.fillStyle = '#1f6b3d';
    ctx.fillRect(w / 2 - 4, h - 14, 8, 14);
    ctx.beginPath();
    ctx.arc(w / 2, h - 14, 8, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#2fb460';
    ctx.fillRect(2, h - 10, 4, 6);
    ctx.fillRect(w - 6, h - 12, 4, 8);
  }, { x: 6, y: 14, width: 8, height: 12 }),
  rock: createProp(18, 14, (ctx, w, h) => {
    ctx.fillStyle = '#6c6861';
    ctx.beginPath();
    ctx.moveTo(2, h - 2);
    ctx.lineTo(w - 4, h - 2);
    ctx.lineTo(w - 2, 6);
    ctx.lineTo(6, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8a857f';
    ctx.beginPath();
    ctx.moveTo(4, h - 4);
    ctx.lineTo(w - 6, h - 4);
    ctx.lineTo(w - 8, 8);
    ctx.lineTo(8, 6);
    ctx.closePath();
    ctx.fill();
  }, { x: 3, y: 6, width: 12, height: 6 }),
  statue: createProp(20, 26, (ctx, w, h) => {
    ctx.fillStyle = '#797a88';
    ctx.fillRect(6, h - 6, w - 12, 6);
    ctx.fillRect(w / 2 - 3, 4, 6, h - 10);
    ctx.beginPath();
    ctx.arc(w / 2, 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c2c3cf';
    ctx.fillRect(w / 2 - 2, 6, 4, 12);
  }, { x: 8, y: 16, width: 4, height: 8 }),
  house: createProp(34, 34, (ctx, w, h) => {
    ctx.fillStyle = '#b87f2a';
    ctx.fillRect(4, h - 12, w - 8, 12);
    ctx.fillStyle = '#f4cc74';
    ctx.fillRect(w / 2 - 4, h - 12, 8, 12);
    ctx.fillStyle = '#7a1f1f';
    ctx.beginPath();
    ctx.moveTo(2, h - 12);
    ctx.lineTo(w / 2, 4);
    ctx.lineTo(w - 2, h - 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8d8a2';
    ctx.fillRect(6, h - 20, 8, 6);
    ctx.fillRect(w - 14, h - 20, 8, 6);
  }, { x: 6, y: 20, width: 22, height: 10 }),
  snowPine: createProp(20, 28, (ctx, w, h) => {
    ctx.fillStyle = '#244a31';
    ctx.fillRect(w / 2 - 3, h - 6, 6, 6);
    ctx.fillStyle = '#e8f2ff';
    ctx.beginPath();
    ctx.moveTo(w / 2, 4);
    ctx.lineTo(w - 4, h - 8);
    ctx.lineTo(4, h - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b9d6f3';
    ctx.beginPath();
    ctx.moveTo(w / 2, 10);
    ctx.lineTo(w - 6, h - 12);
    ctx.lineTo(6, h - 12);
    ctx.closePath();
    ctx.fill();
  }, { x: 6, y: 18, width: 8, height: 8 }),
  crystal: createProp(18, 24, (ctx, w, h) => {
    ctx.fillStyle = '#7bd5ff';
    ctx.beginPath();
    ctx.moveTo(w / 2, 4);
    ctx.lineTo(w - 4, h - 4);
    ctx.lineTo(4, h - 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#dff6ff';
    ctx.beginPath();
    ctx.moveTo(w / 2, 4);
    ctx.lineTo(w - 7, h - 6);
    ctx.lineTo(7, h - 6);
    ctx.closePath();
    ctx.fill();
  }, { x: 6, y: 12, width: 6, height: 12 }),
  brazier: createProp(18, 22, (ctx, w, h) => {
    ctx.fillStyle = '#2d1f1b';
    ctx.fillRect(4, h - 4, w - 8, 4);
    ctx.fillRect(w / 2 - 2, h - 12, 4, 8);
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(w / 2, h - 14, 6, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#ff7847';
    ctx.beginPath();
    ctx.moveTo(w / 2, h - 20);
    ctx.lineTo(w / 2 + 4, h - 10);
    ctx.lineTo(w / 2 - 4, h - 10);
    ctx.closePath();
    ctx.fill();
  }, { x: 5, y: 14, width: 8, height: 8 })
};

function createSavePointSprite() {
  return createProp(22, 18, (ctx, w, h) => {
    ctx.fillStyle = '#272034';
    ctx.fillRect(0, h - 6, w, 6);
    ctx.fillStyle = '#78d0ff';
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(w / 2, h - 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, h - 14);
    ctx.lineTo(w / 2, h - 4);
    ctx.moveTo(w / 2 - 4, h - 9);
    ctx.lineTo(w / 2 + 4, h - 9);
    ctx.stroke();
  });
}

const saveSprite = createSavePointSprite();
function createPlayer(x, y) {
  return {
    type: 'player',
    x,
    y,
    width: 12,
    height: 12,
    speed: 92,
    dashSpeed: 180,
    dashCooldown: 0,
    dashTime: 0,
    hearts: 8,
    maxHearts: 8,
    invulnTimer: 0,
    attackTimer: 0,
    attackCooldown: 0,
    facing: 'down',
    hitFlash: 0,
    attackHitbox: null,
    lastCheckpoint: null,
    swordRange: 34,
    swordWidth: 20,
    swordDuration: 0.18
  };
}

function setPlayerPosition(player, x, y) {
  player.x = x;
  player.y = y;
}
function createEnemy(type, x, y, options = {}) {
  const template = enemyDefinitions[type];
  if (!template) {
    throw new Error(`Unknown enemy type: ${type}`);
  }
  return {
    id: `${type}-${Math.random().toString(36).slice(2)}`,
    type,
    x,
    y,
    width: template.width,
    height: template.height,
    speed: template.speed,
    health: template.health,
    maxHealth: template.health,
    damage: template.damage,
    state: 'idle',
    timer: 0,
    roamRadius: options.roamRadius ?? template.roamRadius,
    anchorX: x,
    anchorY: y,
    hitFlash: 0,
    invulnerable: 0,
    boss: template.boss || false,
    data: { ...template.init?.(options) }
  };
}

function moveEntity(entity, dx, dy, map) {
  const newX = entity.x + dx;
  if (!collidesWithMap(map, newX, entity.y, entity.width, entity.height)) {
    entity.x = newX;
  }
  const newY = entity.y + dy;
  if (!collidesWithMap(map, entity.x, newY, entity.width, entity.height)) {
    entity.y = newY;
  }
}

function collidesWithMap(map, x, y, width, height) {
  const left = Math.floor((x - width / 2) / TILE_SIZE);
  const right = Math.floor((x + width / 2 - 1) / TILE_SIZE);
  const top = Math.floor((y - height / 2) / TILE_SIZE);
  const bottom = Math.floor((y + height / 2 - 1) / TILE_SIZE);
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (tileIsSolid(map, tx, ty)) {
        return true;
      }
    }
  }
  if (map.props) {
    for (const prop of map.props) {
      if (!prop.collisionBox) continue;
      const box = prop.collisionBox;
      const px = prop.x + box.x;
      const py = prop.y + box.y;
      if (
        x + width / 2 > px &&
        x - width / 2 < px + box.width &&
        y + height / 2 > py &&
        y - height / 2 < py + box.height
      ) {
        return true;
      }
    }
  }
  return false;
}

function tileIsSolid(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true;
  const tileKey = map.tiles[ty * map.width + tx];
  const def = tileRegistry[tileKey];
  if (!def) return false;
  return def.isSolid;
}

function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function rectsOverlap(a, b) {
  return !(
    a.x + a.width < b.x ||
    a.x > b.x + b.width ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}

function createMap(definition) {
  const map = {
    id: definition.id,
    width: definition.width,
    height: definition.height,
    tiles: definition.tiles,
    props: definition.props ?? [],
    portals: definition.portals ?? [],
    regions: definition.regions ?? [],
    savePoints: definition.savePoints ?? [],
    enemySpawns: definition.enemySpawns ?? [],
    ambientLight: definition.ambientLight ?? '#000000',
    background: definition.background ?? '#000',
    start: definition.start,
    spawns: definition.spawns ?? {},
    boss: definition.boss ?? null,
    theme: definition.theme ?? 'overworld',
    music: definition.music ?? null
  };
  return map;
}
function announce(text, duration = 3) {
  gameState.hudMessage = text;
  gameState.hudTimer = duration;
}

function revealArea(name) {
  gameState.areaName = name;
  gameState.areaRevealTimer = 3;
}

function setObjective(text) {
  gameState.objectiveText = text;
}

function updateHUD() {
  if (gameState.player) {
    const heartIcon = '❤';
    const emptyHeart = '♡';
    const hearts = heartIcon.repeat(Math.ceil(gameState.player.hearts))
      .slice(0, gameState.player.maxHearts)
      .padEnd(gameState.player.maxHearts, emptyHeart);
    uiLife.textContent = `Life: ${hearts}`;
  }
  uiStatus.textContent = gameState.prompt || gameState.hudMessage;
  uiAreaName.textContent = gameState.areaRevealTimer > 0 ? gameState.areaName : '';
  uiObjective.textContent = gameState.objectiveText;
}
function createPropInstance(kind, x, y) {
  const base = propLibrary[kind];
  if (!base) throw new Error(`Unknown prop: ${kind}`);
  return {
    kind,
    x,
    y,
    width: base.width,
    height: base.height,
    image: base.image,
    collisionBox: base.collisionBox ? { ...base.collisionBox } : null
  };
}
function createSavePoint(x, y, id, label) {
  return {
    type: 'savePoint',
    id,
    label,
    x,
    y,
    width: saveSprite.width,
    height: saveSprite.height,
    image: saveSprite.image,
    collisionBox: { x: 4, y: saveSprite.height - 8, width: saveSprite.width - 8, height: 6 }
  };
}
function blankTiles(width, height, fill = 'grass') {
  return new Array(width * height).fill(fill);
}

function setTile(tiles, width, x, y, tile) {
  if (x < 0 || y < 0 || x >= width) return;
  tiles[y * width + x] = tile;
}

function getTile(tiles, width, x, y) {
  if (x < 0 || y < 0 || x >= width) return null;
  return tiles[y * width + x];
}

function fillRect(tiles, width, height, x0, y0, x1, y1, tile) {
  const minX = Math.max(0, Math.min(x0, x1));
  const maxX = Math.min(width - 1, Math.max(x0, x1));
  const minY = Math.max(0, Math.min(y0, y1));
  const maxY = Math.min(height - 1, Math.max(y0, y1));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      tiles[y * width + x] = tile;
    }
  }
}

function drawPath(tiles, width, height, points, tile) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          setTile(tiles, width, x + dx, y + dy, tile);
        }
      }
    }
  }
}
function generateOverworld() {
  const width = 120;
  const height = 96;
  const tiles = blankTiles(width, height, 'meadow');
  const props = [];
  const enemySpawns = [];
  const savePoints = [];
  const portals = [];
  const regions = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const noise = seededRandom(x, y, 21);
      let tile = 'meadow';
      if (x < 34) {
        tile = noise > 0.9 ? 'flowers' : noise > 0.6 ? 'meadow' : 'grass';
        if (noise > 0.92) {
          const kind = noise > 0.97 ? 'pine' : 'tree';
          const prop = createPropInstance(
            kind,
            x * TILE_SIZE - 2,
            y * TILE_SIZE - (kind === 'tree' ? 12 : 10)
          );
          props.push(prop);
        }
      } else if (x < 70) {
        tile = noise > 0.83 ? 'flowers' : noise > 0.4 ? 'meadow' : 'grass';
        if (noise < 0.06) {
          const prop = createPropInstance('rock', x * TILE_SIZE, y * TILE_SIZE - 4);
          props.push(prop);
        }
      } else {
        tile = noise > 0.65 ? 'dune' : 'sand';
        if (noise > 0.85) {
          const prop = createPropInstance('cactus', x * TILE_SIZE - 2, y * TILE_SIZE - 6);
          props.push(prop);
        }
      }

      if (y < 18 && x > 62) {
        tile = noise > 0.85 ? 'snow_path' : 'snow';
        if (noise > 0.9) {
          const prop = createPropInstance('snowPine', x * TILE_SIZE - 2, y * TILE_SIZE - 12);
          props.push(prop);
        }
      }

      if (x < 28 && y > height - 18) {
        tile = noise > 0.4 ? 'swamp' : 'shallow_water';
        if (noise > 0.92) {
          const prop = createPropInstance('tree', x * TILE_SIZE - 2, y * TILE_SIZE - 10);
          props.push(prop);
        }
      }

      if (y > height - 5) {
        tile = 'water';
      }

      const lakeDX = x - 38;
      const lakeDY = y - 52;
      if (lakeDX * lakeDX + lakeDY * lakeDY < 40) {
        tile = noise > 0.6 ? 'shallow_water' : 'water';
      }

      const oasisDx = x - 92;
      const oasisDy = y - 46;
      if (oasisDx * oasisDx + oasisDy * oasisDy < 36 && y < 70) {
        tile = noise > 0.5 ? 'shallow_water' : 'water';
        if (noise > 0.78) {
          const prop = createPropInstance('cactus', x * TILE_SIZE - 2, y * TILE_SIZE - 6);
          props.push(prop);
        }
      }

      tiles[y * width + x] = tile;
    }
  }

  fillRect(tiles, width, height, 0, 0, width - 1, 3, 'mountain');
  fillRect(tiles, width, height, 0, height - 4, width - 1, height - 1, 'water');
  fillRect(tiles, width, height, 0, 0, 2, height - 1, 'cliff');
  fillRect(tiles, width, height, width - 3, 0, width - 1, height - 1, 'desert_rock');

  drawPath(
    tiles,
    width,
    height,
    [
      [24, 44],
      [40, 44],
      [55, 38],
      [70, 38],
      [78, 42],
      [96, 42],
      [104, 50]
    ],
    'path'
  );

  drawPath(
    tiles,
    width,
    height,
    [
      [40, 56],
      [52, 62],
      [68, 68],
      [82, 70]
    ],
    'stone_path'
  );

  drawPath(
    tiles,
    width,
    height,
    [
      [32, 44],
      [32, 32],
      [28, 24],
      [24, 20]
    ],
    'path'
  );

  for (let x = 30; x < 36; x++) {
    setTile(tiles, width, x, 52, 'planks');
    setTile(tiles, width, x, 53, 'planks');
  }

  props.push(createPropInstance('house', 28 * TILE_SIZE - 6, 46 * TILE_SIZE - 20));
  props.push(createPropInstance('house', 33 * TILE_SIZE - 6, 44 * TILE_SIZE - 20));
  props.push(createPropInstance('statue', 40 * TILE_SIZE - 4, 44 * TILE_SIZE - 12));

  enemySpawns.push(
    { type: 'forest_slime', x: 28 * TILE_SIZE, y: 40 * TILE_SIZE, roamRadius: 72 },
    { type: 'forest_slime', x: 24 * TILE_SIZE, y: 34 * TILE_SIZE, roamRadius: 64 },
    { type: 'forest_slime', x: 35 * TILE_SIZE, y: 50 * TILE_SIZE, roamRadius: 80 },
    { type: 'desert_scarab', x: 88 * TILE_SIZE, y: 48 * TILE_SIZE, roamRadius: 70 },
    { type: 'desert_scarab', x: 102 * TILE_SIZE, y: 60 * TILE_SIZE, roamRadius: 60 },
    { type: 'snow_wraith', x: 78 * TILE_SIZE, y: 18 * TILE_SIZE, roamRadius: 70 },
    { type: 'snow_wraith', x: 92 * TILE_SIZE, y: 16 * TILE_SIZE, roamRadius: 60 },
    { type: 'swamp_bramble', x: 18 * TILE_SIZE, y: 82 * TILE_SIZE, roamRadius: 70 },
    { type: 'swamp_bramble', x: 12 * TILE_SIZE, y: 76 * TILE_SIZE, roamRadius: 60 }
  );

  savePoints.push(
    createSavePoint(32 * TILE_SIZE - 6, 46 * TILE_SIZE - 6, 'village', 'Willow Village'),
    createSavePoint(70 * TILE_SIZE - 6, 38 * TILE_SIZE - 8, 'highlands', 'Highland Crossing'),
    createSavePoint(92 * TILE_SIZE - 6, 56 * TILE_SIZE - 8, 'sunspire', 'Sunspire Outpost'),
    createSavePoint(80 * TILE_SIZE - 6, 20 * TILE_SIZE - 10, 'glacier', 'Frostwind Camp')
  );

  portals.push(
    {
      type: 'dungeon',
      label: 'Verdant Shrine',
      x: 22 * TILE_SIZE,
      y: 20 * TILE_SIZE,
      width: TILE_SIZE,
      height: TILE_SIZE,
      target: 'forest_temple',
      spawn: 'entrance'
    },
    {
      type: 'dungeon',
      label: 'Ember Sanctum',
      x: 86 * TILE_SIZE,
      y: 60 * TILE_SIZE,
      width: TILE_SIZE,
      height: TILE_SIZE,
      target: 'ember_sanctum',
      spawn: 'entrance'
    },
    {
      type: 'dungeon',
      label: 'Glacier Keep',
      x: 92 * TILE_SIZE,
      y: 12 * TILE_SIZE,
      width: TILE_SIZE,
      height: TILE_SIZE,
      target: 'glacier_keep',
      spawn: 'entrance'
    }
  );

  regions.push(
    { name: 'Willow Wilds', rect: { x: 0, y: 28, width: 36, height: 40 } },
    { name: 'Highland Crossing', rect: { x: 36, y: 32, width: 40, height: 28 } },
    { name: 'Sunspire Expanse', rect: { x: 76, y: 32, width: 44, height: 36 } },
    { name: 'Frostwind Peaks', rect: { x: 60, y: 0, width: 40, height: 24 } },
    { name: 'Murkfen Hollow', rect: { x: 0, y: 70, width: 32, height: 26 } }
  );

  return createMap({
    id: 'overworld',
    width,
    height,
    tiles,
    props,
    portals,
    regions,
    savePoints,
    enemySpawns,
    ambientLight: '#203238',
    background: '#203f58',
    start: { x: 32 * TILE_SIZE, y: 46 * TILE_SIZE },
    spawns: {
      forest_exit: { x: 24 * TILE_SIZE, y: 22 * TILE_SIZE },
      ember_exit: { x: 86 * TILE_SIZE, y: 62 * TILE_SIZE },
      glacier_exit: { x: 92 * TILE_SIZE, y: 14 * TILE_SIZE },
      village: { x: 32 * TILE_SIZE, y: 46 * TILE_SIZE }
    },
    theme: 'overworld'
  });
}
function carveRoom(tiles, width, height, x0, y0, x1, y1, floorTile = 'temple_floor') {
  fillRect(tiles, width, height, x0, y0, x1, y1, floorTile);
  for (let x = x0; x <= x1; x++) {
    setTile(tiles, width, x, y0, 'temple_floor');
    setTile(tiles, width, x, y1, 'temple_floor');
  }
  for (let y = y0; y <= y1; y++) {
    setTile(tiles, width, x0, y, 'temple_floor');
    setTile(tiles, width, x1, y, 'temple_floor');
  }
}

function generateForestTemple() {
  const width = 48;
  const height = 48;
  const tiles = blankTiles(width, height, 'temple_wall');
  const props = [];
  const savePoints = [];
  const portals = [];
  const enemySpawns = [];
  const regions = [];

  carveRoom(tiles, width, height, 8, 32, 20, 44, 'temple_floor');
  carveRoom(tiles, width, height, 20, 32, 32, 44, 'temple_floor');
  carveRoom(tiles, width, height, 32, 28, 44, 44, 'temple_floor');
  carveRoom(tiles, width, height, 20, 18, 32, 32, 'temple_floor');
  carveRoom(tiles, width, height, 20, 8, 32, 18, 'temple_floor');
  fillRect(tiles, width, height, 22, 10, 30, 16, 'rune');

  drawPath(
    tiles,
    width,
    height,
    [
      [14, 42],
      [14, 36],
      [26, 36],
      [26, 26],
      [26, 18],
      [26, 12]
    ],
    'temple_floor'
  );

  for (let i = 0; i < 5; i++) {
    props.push(createPropInstance('brazier', (14 + i * 3) * TILE_SIZE, 34 * TILE_SIZE));
  }
  props.push(createPropInstance('statue', 24 * TILE_SIZE, 20 * TILE_SIZE));
  props.push(createPropInstance('statue', 28 * TILE_SIZE, 20 * TILE_SIZE));

  savePoints.push(
    createSavePoint(14 * TILE_SIZE - 4, 38 * TILE_SIZE - 6, 'forest_entry', 'Verdant Antechamber'),
    createSavePoint(26 * TILE_SIZE - 4, 18 * TILE_SIZE - 6, 'forest_boss', 'Sanctum of Roots')
  );

  enemySpawns.push(
    { type: 'temple_sentinel', x: 18 * TILE_SIZE, y: 34 * TILE_SIZE, roamRadius: 48 },
    { type: 'temple_sentinel', x: 28 * TILE_SIZE, y: 34 * TILE_SIZE, roamRadius: 48 },
    { type: 'temple_sentinel', x: 26 * TILE_SIZE, y: 26 * TILE_SIZE, roamRadius: 32 },
    { type: 'vine_keeper', x: 22 * TILE_SIZE, y: 30 * TILE_SIZE, roamRadius: 36 }
  );

  portals.push({
    type: 'exit',
    label: 'To Willow Wilds',
    x: 14 * TILE_SIZE,
    y: 44 * TILE_SIZE,
    width: TILE_SIZE,
    height: TILE_SIZE,
    target: 'overworld',
    spawn: 'forest_exit'
  });

  regions.push(
    { name: 'Verdant Approach', rect: { x: 8, y: 32, width: 24, height: 14 } },
    { name: 'Sanctum Halls', rect: { x: 20, y: 18, width: 12, height: 20 } },
    { name: 'Heart of the Grove', rect: { x: 22, y: 10, width: 10, height: 8 } }
  );

  return createMap({
    id: 'forest_temple',
    width,
    height,
    tiles,
    props,
    savePoints,
    enemySpawns,
    portals,
    regions,
    ambientLight: '#1f2418',
    background: '#1a2b1a',
    start: { x: 14 * TILE_SIZE, y: 42 * TILE_SIZE },
    spawns: {
      entrance: { x: 14 * TILE_SIZE, y: 42 * TILE_SIZE },
      boss: { x: 26 * TILE_SIZE, y: 18 * TILE_SIZE }
    },
    boss: {
      type: 'forest_guardian',
      x: 26 * TILE_SIZE,
      y: 12 * TILE_SIZE,
      radius: 96
    },
    theme: 'dungeon'
  });
}
function generateEmberSanctum() {
  const width = 52;
  const height = 44;
  const tiles = blankTiles(width, height, 'cavern_wall');
  const props = [];
  const savePoints = [];
  const enemySpawns = [];
  const portals = [];
  const regions = [];

  fillRect(tiles, width, height, 6, 30, 20, 42, 'obsidian');
  fillRect(tiles, width, height, 20, 26, 34, 42, 'obsidian');
  fillRect(tiles, width, height, 34, 24, 46, 42, 'obsidian');
  fillRect(tiles, width, height, 20, 12, 34, 26, 'obsidian');
  fillRect(tiles, width, height, 20, 8, 34, 12, 'obsidian');

  for (let x = 10; x < 44; x++) {
    for (let y = 16; y < 32; y++) {
      if ((x - 26) * (x - 26) + (y - 22) * (y - 22) < 48) {
        setTile(tiles, width, x, y, 'lava');
      }
    }
  }

  drawPath(
    tiles,
    width,
    height,
    [
      [12, 36],
      [26, 36],
      [26, 24],
      [26, 16],
      [26, 10]
    ],
    'obsidian'
  );

  for (let i = 0; i < 6; i++) {
    props.push(createPropInstance('brazier', (12 + i * 4) * TILE_SIZE, 32 * TILE_SIZE));
  }

  props.push(createPropInstance('statue', 24 * TILE_SIZE, 18 * TILE_SIZE));
  props.push(createPropInstance('statue', 28 * TILE_SIZE, 18 * TILE_SIZE));

  enemySpawns.push(
    { type: 'ember_lurker', x: 18 * TILE_SIZE, y: 34 * TILE_SIZE, roamRadius: 48 },
    { type: 'ember_lurker', x: 32 * TILE_SIZE, y: 30 * TILE_SIZE, roamRadius: 60 },
    { type: 'ember_lurker', x: 30 * TILE_SIZE, y: 20 * TILE_SIZE, roamRadius: 40 },
    { type: 'cinder_orb', x: 24 * TILE_SIZE, y: 28 * TILE_SIZE, roamRadius: 56 }
  );

  savePoints.push(
    createSavePoint(14 * TILE_SIZE - 4, 34 * TILE_SIZE - 6, 'ember_entry', 'Ashen Causeway'),
    createSavePoint(26 * TILE_SIZE - 4, 14 * TILE_SIZE - 6, 'ember_boss', 'Inferno Gate')
  );

  portals.push({
    type: 'exit',
    label: 'To Sunspire Expanse',
    x: 12 * TILE_SIZE,
    y: 42 * TILE_SIZE,
    width: TILE_SIZE,
    height: TILE_SIZE,
    target: 'overworld',
    spawn: 'ember_exit'
  });

  regions.push(
    { name: 'Ashen Galleries', rect: { x: 8, y: 30, width: 20, height: 12 } },
    { name: 'Molten Basin', rect: { x: 18, y: 16, width: 18, height: 16 } },
    { name: 'Flamekeeper Court', rect: { x: 20, y: 8, width: 12, height: 8 } }
  );

  return createMap({
    id: 'ember_sanctum',
    width,
    height,
    tiles,
    props,
    savePoints,
    enemySpawns,
    portals,
    regions,
    ambientLight: '#2a140c',
    background: '#350d05',
    start: { x: 12 * TILE_SIZE, y: 40 * TILE_SIZE },
    spawns: {
      entrance: { x: 12 * TILE_SIZE, y: 40 * TILE_SIZE },
      boss: { x: 26 * TILE_SIZE, y: 18 * TILE_SIZE }
    },
    boss: {
      type: 'ember_tyrant',
      x: 26 * TILE_SIZE,
      y: 12 * TILE_SIZE,
      radius: 110
    },
    theme: 'dungeon'
  });
}
function generateGlacierKeep() {
  const width = 48;
  const height = 44;
  const tiles = blankTiles(width, height, 'frost_wall');
  const props = [];
  const savePoints = [];
  const enemySpawns = [];
  const portals = [];
  const regions = [];

  fillRect(tiles, width, height, 6, 30, 22, 42, 'frost_floor');
  fillRect(tiles, width, height, 22, 28, 34, 42, 'frost_floor');
  fillRect(tiles, width, height, 22, 16, 34, 28, 'frost_floor');
  fillRect(tiles, width, height, 18, 10, 38, 22, 'frost_floor');
  fillRect(tiles, width, height, 18, 8, 38, 10, 'crystal_floor');

  for (let x = 10; x < 40; x++) {
    for (let y = 20; y < 32; y++) {
      if ((x - 24) * (x - 24) + (y - 26) * (y - 26) < 28) {
        setTile(tiles, width, x, y, 'shallow_water');
      }
    }
  }

  drawPath(
    tiles,
    width,
    height,
    [
      [12, 36],
      [24, 36],
      [24, 26],
      [28, 20],
      [28, 12]
    ],
    'frost_floor'
  );

  for (let i = 0; i < 4; i++) {
    props.push(createPropInstance('crystal', (20 + i * 3) * TILE_SIZE, 24 * TILE_SIZE));
  }
  props.push(createPropInstance('snowPine', 16 * TILE_SIZE, 34 * TILE_SIZE));
  props.push(createPropInstance('snowPine', 32 * TILE_SIZE, 32 * TILE_SIZE));

  enemySpawns.push(
    { type: 'frost_sentry', x: 18 * TILE_SIZE, y: 32 * TILE_SIZE, roamRadius: 44 },
    { type: 'frost_sentry', x: 30 * TILE_SIZE, y: 30 * TILE_SIZE, roamRadius: 42 },
    { type: 'ice_wisp', x: 24 * TILE_SIZE, y: 22 * TILE_SIZE, roamRadius: 52 },
    { type: 'ice_wisp', x: 30 * TILE_SIZE, y: 18 * TILE_SIZE, roamRadius: 50 }
  );

  savePoints.push(
    createSavePoint(12 * TILE_SIZE - 4, 34 * TILE_SIZE - 8, 'glacier_entry', 'Frigid Hall'),
    createSavePoint(28 * TILE_SIZE - 4, 16 * TILE_SIZE - 8, 'glacier_boss', 'Heart of Winter')
  );

  portals.push({
    type: 'exit',
    label: 'To Frostwind Peaks',
    x: 12 * TILE_SIZE,
    y: 42 * TILE_SIZE,
    width: TILE_SIZE,
    height: TILE_SIZE,
    target: 'overworld',
    spawn: 'glacier_exit'
  });

  regions.push(
    { name: 'Frigid Approach', rect: { x: 6, y: 30, width: 24, height: 12 } },
    { name: 'Crystal Gallery', rect: { x: 18, y: 16, width: 18, height: 12 } },
    { name: 'Apex of Frost', rect: { x: 22, y: 8, width: 12, height: 8 } }
  );

  return createMap({
    id: 'glacier_keep',
    width,
    height,
    tiles,
    props,
    savePoints,
    enemySpawns,
    portals,
    regions,
    ambientLight: '#142233',
    background: '#0b1624',
    start: { x: 12 * TILE_SIZE, y: 40 * TILE_SIZE },
    spawns: {
      entrance: { x: 12 * TILE_SIZE, y: 40 * TILE_SIZE },
      boss: { x: 28 * TILE_SIZE, y: 18 * TILE_SIZE }
    },
    boss: {
      type: 'frost_titan',
      x: 28 * TILE_SIZE,
      y: 12 * TILE_SIZE,
      radius: 100
    },
    theme: 'dungeon'
  });
}
const enemyDefinitions = {
  forest_slime: {
    width: 14,
    height: 12,
    speed: 38,
    health: 5,
    damage: 1,
    roamRadius: 72,
    init: () => ({ dirX: 0, dirY: 1, wanderTime: 0 }),
    update(enemy, state, dt) {
      const player = state.player;
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.data.wanderTime -= dt;
      let speed = enemy.speed;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < 120 * 120) {
        const dist = Math.max(Math.hypot(dx, dy), 0.001);
        enemy.data.dirX = dx / dist;
        enemy.data.dirY = dy / dist;
        speed = enemy.speed * 1.35;
      } else if (enemy.data.wanderTime <= 0) {
        const angle = seededRandom(enemy.x, enemy.y, Date.now()) * Math.PI * 2;
        enemy.data.dirX = Math.cos(angle);
        enemy.data.dirY = Math.sin(angle);
        enemy.data.wanderTime = 1.8 + Math.random() * 2;
      }
      moveEntity(enemy, enemy.data.dirX * speed * dt, enemy.data.dirY * speed * dt, state.currentMap);
      if (distSq < 20 * 20) {
        damagePlayer(1, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : '#4bc954';
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a5e29';
      ctx.beginPath();
      ctx.arc(-3, -2, 2, 0, Math.PI * 2);
      ctx.arc(3, -2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
  desert_scarab: {
    width: 16,
    height: 12,
    speed: 44,
    health: 6,
    damage: 1,
    roamRadius: 80,
    init: () => ({ dirX: 0, dirY: 0, cooldown: 0 }),
    update(enemy, state, dt) {
      const player = state.player;
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.data.cooldown -= dt;
      if (enemy.state === 'charge') {
        enemy.timer -= dt;
        const speed = enemy.speed * 2.2;
        moveEntity(enemy, enemy.data.dirX * speed * dt, enemy.data.dirY * speed * dt, state.currentMap);
        if (enemy.timer <= 0) {
          enemy.state = 'idle';
          enemy.data.cooldown = 1.5;
        }
      } else {
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 120 * 120 && enemy.data.cooldown <= 0) {
          const dist = Math.max(Math.hypot(dx, dy), 0.001);
          enemy.data.dirX = dx / dist;
          enemy.data.dirY = dy / dist;
          enemy.state = 'charge';
          enemy.timer = 0.6;
        } else {
          if (enemy.data.cooldown <= 0) {
            const angle = Math.random() * Math.PI * 2;
            enemy.data.dirX = Math.cos(angle);
            enemy.data.dirY = Math.sin(angle);
            enemy.data.cooldown = 2 + Math.random();
          }
          moveEntity(enemy, enemy.data.dirX * enemy.speed * dt, enemy.data.dirY * enemy.speed * dt, state.currentMap);
        }
      }
      if (Math.abs(player.x - enemy.x) < 12 && Math.abs(player.y - enemy.y) < 12) {
        damagePlayer(1, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : '#d2a64b';
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#56320d';
      ctx.fillRect(-6, -2, 12, 4);
      ctx.restore();
    }
  },
  swamp_bramble: {
    width: 18,
    height: 16,
    speed: 0,
    health: 7,
    damage: 1,
    roamRadius: 0,
    init: () => ({ cooldown: 1.2 }),
    update(enemy, state, dt) {
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.data.cooldown -= dt;
      if (enemy.data.cooldown <= 0) {
        const player = state.player;
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const dist = Math.max(Math.hypot(dx, dy), 0.001);
        spawnProjectile({
          x: enemy.x,
          y: enemy.y,
          vx: (dx / dist) * 80,
          vy: (dy / dist) * 80,
          damage: 1,
          life: 1.4,
          color: '#5ad05f'
        });
        enemy.data.cooldown = 2.2;
      }
      const player = state.player;
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 18 * 18) {
        damagePlayer(1, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : '#1a5e29';
      ctx.beginPath();
      ctx.moveTo(-8, 6);
      ctx.lineTo(0, -8);
      ctx.lineTo(8, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#56b45b';
      ctx.fillRect(-4, 2, 8, 6);
      ctx.restore();
    }
  },
  snow_wraith: {
    width: 18,
    height: 18,
    speed: 32,
    health: 8,
    damage: 1,
    roamRadius: 72,
    init: () => ({ angle: 0, cooldown: 1 }),
    update(enemy, state, dt) {
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      const player = state.player;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.001);
      enemy.data.angle += dt * 1.5;
      const circleX = Math.cos(enemy.data.angle) * 16;
      const circleY = Math.sin(enemy.data.angle) * 16;
      moveEntity(
        enemy,
        (dx / dist) * enemy.speed * dt + circleX * 0.02,
        (dy / dist) * enemy.speed * dt + circleY * 0.02,
        state.currentMap
      );
      enemy.data.cooldown -= dt;
      if (enemy.data.cooldown <= 0) {
        const px = player.x;
        const py = player.y;
        const pdx = px - enemy.x;
        const pdy = py - enemy.y;
        const pd = Math.max(Math.hypot(pdx, pdy), 0.001);
        spawnProjectile({
          x: enemy.x,
          y: enemy.y,
          vx: (pdx / pd) * 90,
          vy: (pdy / pd) * 90,
          damage: 1,
          life: 1.6,
          color: '#dff6ff'
        });
        enemy.data.cooldown = 2 + Math.random();
      }
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 18 * 18) {
        damagePlayer(1, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : 'rgba(210, 242, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7fc5ff';
      ctx.stroke();
      ctx.restore();
    }
  },
  temple_sentinel: {
    width: 18,
    height: 20,
    speed: 28,
    health: 12,
    damage: 2,
    roamRadius: 40,
    init: () => ({ dirX: 0, dirY: 0, cooldown: 0 }),
    update(enemy, state, dt) {
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      const player = state.player;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.001);
      if (dist < 100) {
        enemy.data.dirX = dx / dist;
        enemy.data.dirY = dy / dist;
      } else if (enemy.data.cooldown <= 0) {
        const angle = Math.random() * Math.PI * 2;
        enemy.data.dirX = Math.cos(angle);
        enemy.data.dirY = Math.sin(angle);
        enemy.data.cooldown = 3;
      }
      moveEntity(enemy, enemy.data.dirX * enemy.speed * dt, enemy.data.dirY * enemy.speed * dt, state.currentMap);
      enemy.data.cooldown -= dt;
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 20 * 20) {
        damagePlayer(1, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : '#6c5e7f';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = '#2f2536';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
  },
  vine_keeper: {
    width: 16,
    height: 18,
    speed: 24,
    health: 10,
    damage: 1,
    roamRadius: 50,
    init: () => ({ cooldown: 1.5 }),
    update(enemy, state, dt) {
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.data.cooldown -= dt;
      const player = state.player;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.001);
      moveEntity(enemy, (dx / dist) * enemy.speed * dt * 0.6, (dy / dist) * enemy.speed * dt * 0.6, state.currentMap);
      if (enemy.data.cooldown <= 0) {
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 * i) / 5;
          spawnProjectile({
            x: enemy.x,
            y: enemy.y,
            vx: Math.cos(angle) * 60,
            vy: Math.sin(angle) * 60,
            damage: 1,
            life: 1.3,
            color: '#7fe87f'
          });
        }
        enemy.data.cooldown = 2.5;
      }
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 16 * 16) {
        damagePlayer(1, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : '#2f7f34';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#94e49a';
      ctx.fillRect(-6, 0, 12, 4);
      ctx.restore();
    }
  },
  ember_lurker: {
    width: 16,
    height: 14,
    speed: 50,
    health: 10,
    damage: 2,
    roamRadius: 64,
    init: () => ({ cooldown: 1, dirX: 0, dirY: 0 }),
    update(enemy, state, dt) {
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.data.cooldown -= dt;
      if (enemy.state === 'pounce') {
        enemy.timer -= dt;
        moveEntity(enemy, enemy.data.dirX * enemy.speed * 2.3 * dt, enemy.data.dirY * enemy.speed * 2.3 * dt, state.currentMap);
        if (enemy.timer <= 0) {
          enemy.state = 'idle';
          enemy.data.cooldown = 1.5;
        }
      } else if (enemy.data.cooldown <= 0) {
        const player = state.player;
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const dist = Math.max(Math.hypot(dx, dy), 0.001);
        enemy.data.dirX = dx / dist;
        enemy.data.dirY = dy / dist;
        enemy.state = 'pounce';
        enemy.timer = 0.5;
      } else {
        moveEntity(enemy, enemy.data.dirX * enemy.speed * dt, enemy.data.dirY * enemy.speed * dt, state.currentMap);
      }
      const player = state.player;
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 18 * 18) {
        damagePlayer(1, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : '#ff7847';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff3a1e';
      ctx.fillRect(-6, -2, 12, 4);
      ctx.restore();
    }
  },
  cinder_orb: {
    width: 16,
    height: 16,
    speed: 26,
    health: 12,
    damage: 2,
    roamRadius: 40,
    init: () => ({ angle: 0, cooldown: 1.2 }),
    update(enemy, state, dt) {
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.data.angle += dt * 1.8;
      const player = state.player;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.001);
      moveEntity(enemy, (dx / dist) * enemy.speed * dt, (dy / dist) * enemy.speed * dt, state.currentMap);
      enemy.data.cooldown -= dt;
      if (enemy.data.cooldown <= 0) {
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI * 2 * i) / 6 + enemy.data.angle;
          spawnProjectile({
            x: enemy.x,
            y: enemy.y,
            vx: Math.cos(angle) * 90,
            vy: Math.sin(angle) * 90,
            damage: 1,
            life: 1.4,
            color: '#ffbf54'
          });
        }
        enemy.data.cooldown = 2.4;
      }
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 18 * 18) {
        damagePlayer(2, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      const gradient = ctx.createRadialGradient(0, 0, 2, 0, 0, 10);
      gradient.addColorStop(0, '#ffe29b');
      gradient.addColorStop(1, enemy.hitFlash > 0 ? '#ffffff' : '#ff5c2a');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
  frost_sentry: {
    width: 16,
    height: 18,
    speed: 30,
    health: 11,
    damage: 1,
    roamRadius: 60,
    init: () => ({ cooldown: 1.6, dirX: 0, dirY: 0 }),
    update(enemy, state, dt) {
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.data.cooldown -= dt;
      const player = state.player;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.001);
      if (enemy.data.cooldown <= 0) {
        spawnProjectile({
          x: enemy.x,
          y: enemy.y,
          vx: (dx / dist) * 75,
          vy: (dy / dist) * 75,
          damage: 1,
          life: 1.5,
          color: '#9bd3ff'
        });
        enemy.data.cooldown = 2 + Math.random();
      }
      enemy.data.dirX = dx / dist;
      enemy.data.dirY = dy / dist;
      moveEntity(enemy, enemy.data.dirX * enemy.speed * dt * 0.6, enemy.data.dirY * enemy.speed * dt * 0.6, state.currentMap);
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 18 * 18) {
        damagePlayer(1, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : '#8fbde6';
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeStyle = '#dff6ff';
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.restore();
    }
  },
  ice_wisp: {
    width: 14,
    height: 14,
    speed: 36,
    health: 8,
    damage: 1,
    roamRadius: 70,
    init: () => ({ angle: Math.random() * Math.PI * 2 }),
    update(enemy, state, dt) {
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.data.angle += dt * 2;
      const radius = 18;
      const targetX = enemy.anchorX + Math.cos(enemy.data.angle) * radius;
      const targetY = enemy.anchorY + Math.sin(enemy.data.angle) * radius;
      const dx = targetX - enemy.x;
      const dy = targetY - enemy.y;
      moveEntity(enemy, dx * dt, dy * dt, state.currentMap);
      const player = state.player;
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 16 * 16) {
        damagePlayer(1, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : 'rgba(180, 224, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
  forest_guardian: {
    width: 28,
    height: 28,
    speed: 34,
    health: 60,
    damage: 2,
    roamRadius: 0,
    boss: true,
    init: () => ({ phase: 1, cooldown: 1.5, slamTimer: 4 }),
    update(enemy, state, dt) {
      const player = state.player;
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.data.cooldown -= dt;
      enemy.data.slamTimer -= dt;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.001);
      moveEntity(enemy, (dx / dist) * enemy.speed * dt * 0.6, (dy / dist) * enemy.speed * dt * 0.6, state.currentMap);
      if (enemy.data.cooldown <= 0) {
        const roots = 6;
        for (let i = 0; i < roots; i++) {
          const angle = (Math.PI * 2 * i) / roots;
          spawnProjectile({
            x: enemy.x,
            y: enemy.y,
            vx: Math.cos(angle) * 70,
            vy: Math.sin(angle) * 70,
            damage: 2,
            life: 1.6,
            color: '#5bd072',
            radius: 4
          });
        }
        enemy.data.cooldown = 3.5;
      }
      if (enemy.data.slamTimer <= 0) {
        const angle = Math.atan2(dy, dx);
        enemy.data.dirX = Math.cos(angle);
        enemy.data.dirY = Math.sin(angle);
        enemy.state = 'slam';
        enemy.timer = 0.8;
        enemy.data.slamTimer = 6;
      }
      if (enemy.state === 'slam') {
        enemy.timer -= dt;
        moveEntity(enemy, enemy.data.dirX * enemy.speed * 3 * dt, enemy.data.dirY * enemy.speed * 3 * dt, state.currentMap);
        if (enemy.timer <= 0) {
          enemy.state = 'idle';
        }
      }
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 28 * 28) {
        damagePlayer(2, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : '#3e6f34';
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#72d163';
      ctx.beginPath();
      ctx.arc(0, -4, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
  ember_tyrant: {
    width: 28,
    height: 28,
    speed: 40,
    health: 70,
    damage: 2,
    roamRadius: 0,
    boss: true,
    init: () => ({ cooldown: 1.2, burstTimer: 4 }),
    update(enemy, state, dt) {
      const player = state.player;
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.001);
      moveEntity(enemy, (dx / dist) * enemy.speed * dt * 0.6, (dy / dist) * enemy.speed * dt * 0.6, state.currentMap);
      enemy.data.cooldown -= dt;
      enemy.data.burstTimer -= dt;
      if (enemy.data.cooldown <= 0) {
        spawnProjectile({
          x: enemy.x,
          y: enemy.y,
          vx: (dx / dist) * 120,
          vy: (dy / dist) * 120,
          damage: 2,
          life: 1.4,
          color: '#ff7847'
        });
        enemy.data.cooldown = 1.4;
      }
      if (enemy.data.burstTimer <= 0) {
        for (let i = 0; i < 10; i++) {
          const angle = (Math.PI * 2 * i) / 10;
          spawnProjectile({
            x: enemy.x,
            y: enemy.y,
            vx: Math.cos(angle) * 100,
            vy: Math.sin(angle) * 100,
            damage: 2,
            life: 1.2,
            color: '#ffa564'
          });
        }
        enemy.data.burstTimer = 5;
      }
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 26 * 26) {
        damagePlayer(2, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      const gradient = ctx.createRadialGradient(0, 0, 4, 0, 0, 18);
      gradient.addColorStop(0, '#ffd37f');
      gradient.addColorStop(1, enemy.hitFlash > 0 ? '#ffffff' : '#d9471f');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
  frost_titan: {
    width: 30,
    height: 30,
    speed: 34,
    health: 75,
    damage: 2,
    roamRadius: 0,
    boss: true,
    init: () => ({ shardTimer: 2, slamTimer: 5 }),
    update(enemy, state, dt) {
      const player = state.player;
      enemy.invulnerable = Math.max(0, enemy.invulnerable - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.001);
      moveEntity(enemy, (dx / dist) * enemy.speed * dt * 0.55, (dy / dist) * enemy.speed * dt * 0.55, state.currentMap);
      enemy.data.shardTimer -= dt;
      enemy.data.slamTimer -= dt;
      if (enemy.data.shardTimer <= 0) {
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 * i) / 8;
          spawnProjectile({
            x: enemy.x,
            y: enemy.y,
            vx: Math.cos(angle) * 90,
            vy: Math.sin(angle) * 90,
            damage: 2,
            life: 1.8,
            color: '#bce8ff'
          });
        }
        enemy.data.shardTimer = 3.2;
      }
      if (enemy.data.slamTimer <= 0) {
        enemy.state = 'slam';
        enemy.timer = 1;
        enemy.data.slamTimer = 6;
      }
      if (enemy.state === 'slam') {
        enemy.timer -= dt;
        if (enemy.timer <= 0) {
          enemy.state = 'idle';
          createShockwave(enemy.x, enemy.y, 60, 2);
        }
      }
      if (distanceSquared(enemy.x, enemy.y, player.x, player.y) < 28 * 28) {
        damagePlayer(2, enemy);
      }
    },
    draw(enemy, ctx, camera) {
      const screenX = Math.floor(enemy.x - camera.x);
      const screenY = Math.floor(enemy.y - camera.y);
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : '#8ec4ff';
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d9f0ff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }
};
function spawnProjectile({ x, y, vx, vy, damage, life, color, radius = 3, friendly = false }) {
  gameState.projectiles.push({ x, y, vx, vy, damage, life, color, radius, friendly });
}

function spawnParticle(x, y, color, life = 0.5) {
  gameState.particles.push({ x, y, color, life, maxLife: life });
}

function createShockwave(x, y, radius, damage) {
  gameState.effects.push({
    type: 'shockwave',
    x,
    y,
    radius: 4,
    maxRadius: radius,
    life: 0.5,
    damage,
    applied: false
  });
}
function damagePlayer(amount, source = null) {
  const player = gameState.player;
  if (!player || player.invulnTimer > 0) return;
  player.hearts = Math.max(0, player.hearts - amount);
  player.invulnTimer = 1.2;
  player.hitFlash = 0.4;
  spawnParticle(player.x, player.y, '#ff6666', 0.5);
  announce('You are hurt!', 1.2);
  if (player.hearts <= 0) {
    handlePlayerDefeat();
  }
}

function healPlayer(amount) {
  const player = gameState.player;
  if (!player) return;
  player.hearts = clamp(player.hearts + amount, 0, player.maxHearts);
}

function handlePlayerDefeat() {
  announce('You collapse but the land remembers...', 3);
  const saved = gameState.lastSave;
  if (saved) {
    setTimeout(() => {
      restoreFromSave(saved);
    }, 100);
  } else {
    const map = gameState.currentMap;
    setPlayerPosition(gameState.player, map.start.x, map.start.y);
    gameState.player.hearts = gameState.player.maxHearts;
  }
}

function saveGameAtPoint(point) {
  const saveData = {
    mapId: gameState.currentMap.id,
    x: gameState.player.x,
    y: gameState.player.y,
    hearts: gameState.player.hearts,
    maxHearts: gameState.player.maxHearts,
    flags: { ...gameState.flags }
  };
  gameState.lastSave = saveData;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saveData));
  } catch (err) {
    console.warn('Save failed', err);
  }
  announce(`Progress saved at ${point.label}!`, 2.5);
}

function restoreFromSave(data) {
  const targetMap = gameState.maps.get(data.mapId) ?? gameState.maps.get('overworld');
  if (targetMap) {
    enterMap(targetMap.id, null, { x: data.x, y: data.y });
  }
  gameState.player.hearts = clamp(data.hearts ?? gameState.player.maxHearts, 1, data.maxHearts ?? gameState.player.maxHearts);
  gameState.player.maxHearts = data.maxHearts ?? gameState.player.maxHearts;
  gameState.flags = { ...gameState.flags, ...(data.flags ?? {}) };
  updateHUD();
  if (!gameState.flags.forestBossDefeated) {
    setObjective('Cleanse the Verdant Shrine of its guardian.');
  } else if (!gameState.flags.emberBossDefeated) {
    setObjective('Extinguish the Ember Tyrant within the sanctum.');
  } else if (!gameState.flags.frostBossDefeated) {
    setObjective('Shatter the Frost Titan ruling the keep.');
  } else {
    setObjective('The realm is safe. Explore freely or revisit the lands.');
  }
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data) return;
    gameState.lastSave = data;
    restoreFromSave(data);
  } catch (err) {
    console.warn('Failed to load save', err);
  }
}
function spawnEnemies(map) {
  gameState.enemies = map.enemySpawns.map((spawn) =>
    createEnemy(spawn.type, spawn.x, spawn.y, { roamRadius: spawn.roamRadius })
  );
  if (map.boss) {
    const defeatedFlag = getBossFlag(map.boss.type);
    if (!gameState.flags[defeatedFlag]) {
      const boss = createEnemy(map.boss.type, map.boss.x, map.boss.y, {});
      boss.anchorX = map.boss.x;
      boss.anchorY = map.boss.y;
      boss.roamRadius = map.boss.radius ?? 100;
      gameState.enemies.push(boss);
    }
  }
}

function getBossFlag(bossType) {
  switch (bossType) {
    case 'forest_guardian':
      return 'forestBossDefeated';
    case 'ember_tyrant':
      return 'emberBossDefeated';
    case 'frost_titan':
      return 'frostBossDefeated';
    default:
      return 'forestBossDefeated';
  }
}

function enterMap(mapId, spawnKey = null, overridePosition = null) {
  const map = typeof mapId === 'string' ? gameState.maps.get(mapId) : mapId;
  if (!map) return;
  gameState.currentMap = map;
  gameState.projectiles = [];
  gameState.effects = [];
  gameState.particles = [];
  gameState.prompt = '';
  spawnEnemies(map);
  const spawn = overridePosition || (spawnKey && map.spawns[spawnKey]) || map.start;
  if (!gameState.player) {
    gameState.player = createPlayer(spawn.x, spawn.y);
  }
  setPlayerPosition(gameState.player, spawn.x, spawn.y);
  gameState.player.invulnTimer = 0;
  gameState.player.attackCooldown = 0;
  gameState.currentRegion = null;
  announce(`Entered ${map.id.replace(/_/g, ' ')}`, 2);
  updateRegionName();
}

function updateRegionName() {
  const map = gameState.currentMap;
  const player = gameState.player;
  if (!map || !player) return;
  for (const region of map.regions) {
    const { x, y, width, height } = region.rect;
    if (
      player.x >= x * TILE_SIZE &&
      player.x <= (x + width) * TILE_SIZE &&
      player.y >= y * TILE_SIZE &&
      player.y <= (y + height) * TILE_SIZE
    ) {
      if (gameState.currentRegion !== region.name) {
        revealArea(region.name);
        gameState.currentRegion = region.name;
      }
      return;
    }
  }
  if (map.id === 'overworld') {
    if (gameState.currentRegion !== 'Wildlands of Aurel') {
      revealArea('Wildlands of Aurel');
      gameState.currentRegion = 'Wildlands of Aurel';
    }
  }
}
function initializeGame() {
  const overworld = generateOverworld();
  const forestTemple = generateForestTemple();
  const emberSanctum = generateEmberSanctum();
  const glacierKeep = generateGlacierKeep();

  ;[overworld, forestTemple, emberSanctum, glacierKeep].forEach((map) => {
    gameState.maps.set(map.id, map);
  });

  enterMap('overworld', 'village');
  gameState.player.maxHearts = 8;
  gameState.player.hearts = 8;
  updateHUD();
  setObjective('Seek the three temples and quell their guardians.');
  loadSavedGame();
}
function handleInteractions() {
  const player = gameState.player;
  const map = gameState.currentMap;
  if (!player || !map) return;
  const playerRect = {
    x: player.x - player.width / 2,
    y: player.y - player.height / 2,
    width: player.width,
    height: player.height
  };
  let prompt = '';

  for (const point of map.savePoints) {
    const rect = { x: point.x, y: point.y, width: point.width, height: point.height };
    if (rectsOverlap(playerRect, rect)) {
      prompt = `Press Enter to rest at ${point.label}`;
      if (justPressed.interact) {
        saveGameAtPoint(point);
      }
      break;
    }
  }

  if (!prompt) {
    for (const portal of map.portals) {
      const rect = { x: portal.x, y: portal.y, width: portal.width, height: portal.height };
      if (rectsOverlap(playerRect, rect)) {
        prompt = `Press Enter to travel to ${portal.label}`;
        if (justPressed.interact) {
          usePortal(portal);
          prompt = '';
        }
        break;
      }
    }
  }

  gameState.prompt = prompt;
}

function usePortal(portal) {
  if (portal.target === 'forest_temple' && gameState.flags.forestBossDefeated) {
    announce('The shrine lies quiet. You have already saved it.', 2);
  }
  enterMap(portal.target, portal.spawn ?? 'entrance');
  if (portal.target === 'forest_temple') {
    if (!gameState.flags.forestBossDefeated) {
      setObjective('Cleanse the Verdant Shrine of its guardian.');
    } else {
      setObjective('Revisit the tranquil shrine or continue your quest.');
    }
  } else if (portal.target === 'ember_sanctum') {
    if (!gameState.flags.emberBossDefeated) {
      setObjective('Extinguish the Ember Tyrant within the sanctum.');
    } else {
      setObjective('The sanctum is calmed. Pursue the final temple.');
    }
  } else if (portal.target === 'glacier_keep') {
    if (!gameState.flags.frostBossDefeated) {
      setObjective('Shatter the Frost Titan ruling the keep.');
    } else {
      setObjective('The peaks are peaceful. Explore as you wish.');
    }
  } else if (portal.target === 'overworld') {
    setObjective('Discover the remaining temples across the realm.');
  }
}
function damageEnemy(enemy, amount) {
  if (enemy.invulnerable > 0) return;
  enemy.health -= amount;
  enemy.hitFlash = 0.2;
  enemy.invulnerable = 0.2;
  spawnParticle(enemy.x, enemy.y, '#fff7a8', 0.4);
  if (enemy.health <= 0) {
    enemy.dead = true;
    onEnemyDefeated(enemy);
  }
}

function onEnemyDefeated(enemy) {
  spawnParticle(enemy.x, enemy.y, '#ffffff', 0.6);
  if (enemy.boss) {
    const flag = getBossFlag(enemy.type);
    gameState.flags[flag] = true;
    if (enemy.type === 'forest_guardian') {
      announce('The Verdant Guardian is defeated! The forest breathes freely.', 4);
      setObjective('Return outside and continue your quest.');
      gameState.player.maxHearts += 1;
      healPlayer(gameState.player.maxHearts);
    } else if (enemy.type === 'ember_tyrant') {
      announce('The Ember Tyrant is extinguished! The caverns cool.', 4);
      setObjective('Return to the surface and brave the last temple.');
      gameState.player.maxHearts += 1;
      healPlayer(gameState.player.maxHearts);
    } else if (enemy.type === 'frost_titan') {
      announce('The Frost Titan shatters! Peace returns to the peaks.', 4);
      setObjective('The realm is safe. Explore freely or revisit the lands.');
      gameState.player.maxHearts += 1;
      healPlayer(gameState.player.maxHearts);
    }
  } else {
    if (Math.random() < 0.2) {
      healPlayer(1);
      announce('You recovered a heart shard.', 1.5);
    }
  }
}
function attackEnemies(hitbox, damage) {
  const rect = {
    x: hitbox.x,
    y: hitbox.y,
    width: hitbox.width,
    height: hitbox.height
  };
  for (const enemy of gameState.enemies) {
    if (enemy.dead) continue;
    if (hitbox.hitIds?.has(enemy.id)) continue;
    const enemyRect = {
      x: enemy.x - enemy.width / 2,
      y: enemy.y - enemy.height / 2,
      width: enemy.width,
      height: enemy.height
    };
    if (rectsOverlap(rect, enemyRect)) {
      damageEnemy(enemy, damage);
      hitbox.hitIds?.add(enemy.id);
    }
  }
}
function updatePlayer(dt) {
  const player = gameState.player;
  if (!player) return;
  player.invulnTimer = Math.max(0, player.invulnTimer - dt);
  player.hitFlash = Math.max(0, player.hitFlash - dt);
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  if (player.dashCooldown > 0) player.dashCooldown -= dt;
  if (player.dashTime > 0) player.dashTime -= dt;

  let moveX = 0;
  let moveY = 0;
  if (inputState.left) moveX -= 1;
  if (inputState.right) moveX += 1;
  if (inputState.up) moveY -= 1;
  if (inputState.down) moveY += 1;
  if (moveX !== 0 || moveY !== 0) {
    const length = Math.hypot(moveX, moveY) || 1;
    moveX /= length;
    moveY /= length;
    if (Math.abs(moveX) > Math.abs(moveY)) {
      player.facing = moveX > 0 ? 'right' : 'left';
    } else {
      player.facing = moveY > 0 ? 'down' : 'up';
    }
  }

  if (justPressed.dash && player.dashCooldown <= 0) {
    player.dashTime = 0.22;
    player.dashCooldown = 1.1;
    spawnParticle(player.x, player.y, '#d8f7ff', 0.3);
  }

  const moveSpeed = player.dashTime > 0 ? player.dashSpeed : player.speed;
  moveEntity(player, moveX * moveSpeed * dt, moveY * moveSpeed * dt, gameState.currentMap);

  if (justPressed.attack && player.attackCooldown <= 0) {
    performAttack(player);
  }

  if (player.attackHitbox) {
    player.attackHitbox.ttl -= dt;
    if (player.attackHitbox.ttl <= 0) {
      player.attackHitbox = null;
    } else {
      attackEnemies(player.attackHitbox, 4);
    }
  }

  handleInteractions();
  updateRegionName();
}

function performAttack(player) {
  player.attackCooldown = 0.38;
  player.attackTimer = player.swordDuration;
  const range = player.swordRange;
  const width = player.swordWidth;
  let hitbox;
  switch (player.facing) {
    case 'up':
      hitbox = {
        x: player.x - width / 2,
        y: player.y - range - player.height / 2,
        width,
        height: range
      };
      break;
    case 'down':
      hitbox = {
        x: player.x - width / 2,
        y: player.y + player.height / 2,
        width,
        height: range
      };
      break;
    case 'left':
      hitbox = {
        x: player.x - range - player.width / 2,
        y: player.y - width / 2,
        width: range,
        height: width
      };
      break;
    default:
      hitbox = {
        x: player.x + player.width / 2,
        y: player.y - width / 2,
        width: range,
        height: width
      };
      break;
  }
  player.attackHitbox = { ...hitbox, ttl: player.swordDuration, hitIds: new Set() };
  spawnParticle(player.x, player.y, '#f7f1aa', 0.3);
}
function updateEnemies(dt) {
  const state = { player: gameState.player, currentMap: gameState.currentMap };
  for (const enemy of gameState.enemies) {
    if (enemy.dead) continue;
    const def = enemyDefinitions[enemy.type];
    if (def && def.update) {
      def.update(enemy, state, dt);
    }
  }
  gameState.enemies = gameState.enemies.filter((enemy) => !enemy.dead);
}
function updateProjectiles(dt) {
  const map = gameState.currentMap;
  const remaining = [];
  for (const proj of gameState.projectiles) {
    proj.life -= dt;
    if (proj.life <= 0) continue;
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    const tileX = Math.floor(proj.x / TILE_SIZE);
    const tileY = Math.floor(proj.y / TILE_SIZE);
    if (tileIsSolid(map, tileX, tileY)) {
      spawnParticle(proj.x, proj.y, proj.color, 0.25);
      continue;
    }
    let hit = false;
    if (proj.friendly) {
      for (const enemy of gameState.enemies) {
        if (enemy.dead) continue;
        const distSq = distanceSquared(proj.x, proj.y, enemy.x, enemy.y);
        if (distSq < Math.pow(proj.radius + Math.max(enemy.width, enemy.height) / 2, 2)) {
          damageEnemy(enemy, 3);
          hit = true;
          break;
        }
      }
    } else if (gameState.player) {
      const player = gameState.player;
      const distSq = distanceSquared(proj.x, proj.y, player.x, player.y);
      if (distSq < Math.pow(proj.radius + Math.max(player.width, player.height) / 2, 2)) {
        damagePlayer(proj.damage, proj);
        hit = true;
      }
    }
    if (!hit) {
      remaining.push(proj);
    } else {
      spawnParticle(proj.x, proj.y, proj.color, 0.3);
    }
  }
  gameState.projectiles = remaining;
}
function updateParticles(dt) {
  const particles = [];
  for (const particle of gameState.particles) {
    particle.life -= dt;
    if (particle.life > 0) {
      particles.push(particle);
    }
  }
  gameState.particles = particles;
}

function updateEffects(dt) {
  const effects = [];
  for (const effect of gameState.effects) {
    effect.life -= dt;
    if (effect.type === 'shockwave') {
      effect.radius = Math.min(effect.radius + dt * effect.maxRadius * 4, effect.maxRadius);
      if (!effect.applied && gameState.player) {
        const player = gameState.player;
        const distSq = distanceSquared(effect.x, effect.y, player.x, player.y);
        if (distSq < Math.pow(effect.radius + Math.max(player.width, player.height) / 2, 2)) {
          damagePlayer(effect.damage, effect);
          effect.applied = true;
        }
      }
    }
    if (effect.life > 0) {
      effects.push(effect);
    }
  }
  gameState.effects = effects;
}
function updateHudTimers(dt) {
  if (gameState.hudTimer > 0) {
    gameState.hudTimer -= dt;
    if (gameState.hudTimer <= 0) {
      gameState.hudMessage = '';
    }
  }
  if (gameState.areaRevealTimer > 0) {
    gameState.areaRevealTimer -= dt;
    if (gameState.areaRevealTimer <= 0) {
      gameState.areaName = '';
    }
  }
}
function render() {
  ctx.fillStyle = gameState.currentMap?.background ?? '#000';
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  if (!gameState.currentMap) return;
  drawTiles();
  drawProps();
  drawSavePoints();
  drawEnemies();
  drawPlayer();
  drawProjectiles();
  drawEffects();
  drawParticles();
}

function drawTiles() {
  const map = gameState.currentMap;
  const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
  const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
  const endX = Math.min(map.width, Math.ceil((camera.x + VIEW_WIDTH) / TILE_SIZE));
  const endY = Math.min(map.height, Math.ceil((camera.y + VIEW_HEIGHT) / TILE_SIZE));
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const tileKey = map.tiles[y * map.width + x] || 'grass';
      const tileType = tileRegistry[tileKey] ?? tileRegistry.grass;
      const texture = getVariant(tileType, x, y) ?? tileType.variants[0];
      const screenX = Math.floor(x * TILE_SIZE - camera.x);
      const screenY = Math.floor(y * TILE_SIZE - camera.y);
      ctx.drawImage(texture, screenX, screenY);
    }
  }
}

function drawProps() {
  const map = gameState.currentMap;
  for (const prop of map.props) {
    const screenX = Math.floor(prop.x - camera.x);
    const screenY = Math.floor(prop.y - camera.y);
    ctx.drawImage(prop.image, screenX, screenY);
  }
}

function drawSavePoints() {
  const map = gameState.currentMap;
  for (const point of map.savePoints) {
    const screenX = Math.floor(point.x - camera.x);
    const screenY = Math.floor(point.y - camera.y);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(point.image, screenX, screenY);
    ctx.globalAlpha = 1;
  }
}

function drawPlayer() {
  const player = gameState.player;
  if (!player) return;
  const screenX = Math.floor(player.x - camera.x);
  const screenY = Math.floor(player.y - camera.y);
  ctx.save();
  ctx.translate(screenX, screenY);
  if (player.attackHitbox) {
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#fff3a8';
    ctx.fillRect(
      player.attackHitbox.x - player.x,
      player.attackHitbox.y - player.y,
      player.attackHitbox.width,
      player.attackHitbox.height
    );
    ctx.restore();
  }
  ctx.fillStyle = player.hitFlash > 0 ? '#ffffff' : '#2c9434';
  ctx.fillRect(-7, -6, 14, 12);
  ctx.fillStyle = '#f6d2a1';
  ctx.fillRect(-5, -12, 10, 6);
  ctx.fillStyle = '#207628';
  ctx.fillRect(-7, 2, 14, 4);
  ctx.fillStyle = '#d7b26d';
  ctx.fillRect(-6, -13, 12, 3);
  ctx.fillStyle = '#3ba94a';
  ctx.beginPath();
  ctx.moveTo(-6, -13);
  ctx.lineTo(0, -18);
  ctx.lineTo(6, -13);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEnemies() {
  for (const enemy of gameState.enemies) {
    if (enemy.dead) continue;
    const def = enemyDefinitions[enemy.type];
    if (!def || !def.draw) continue;
    def.draw(enemy, ctx, camera);
  }
}

function drawProjectiles() {
  for (const proj of gameState.projectiles) {
    const screenX = Math.floor(proj.x - camera.x);
    const screenY = Math.floor(proj.y - camera.y);
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = proj.color;
    ctx.beginPath();
    ctx.arc(screenX, screenY, proj.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawParticles() {
  for (const particle of gameState.particles) {
    const alpha = particle.life / particle.maxLife;
    const screenX = Math.floor(particle.x - camera.x);
    const screenY = Math.floor(particle.y - camera.y);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.fillRect(screenX - 2, screenY - 2, 4, 4);
    ctx.restore();
  }
}

function drawEffects() {
  for (const effect of gameState.effects) {
    if (effect.type === 'shockwave') {
      const screenX = Math.floor(effect.x - camera.x);
      const screenY = Math.floor(effect.y - camera.y);
      ctx.save();
      ctx.globalAlpha = clamp(effect.life / 0.5, 0, 0.8);
      ctx.strokeStyle = '#bfe7ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(screenX, screenY, effect.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
function updateCamera() {
  const map = gameState.currentMap;
  const player = gameState.player;
  if (!map || !player) return;
  const maxX = map.width * TILE_SIZE - VIEW_WIDTH;
  const maxY = map.height * TILE_SIZE - VIEW_HEIGHT;
  camera.x = clamp(player.x - VIEW_WIDTH / 2, 0, Math.max(0, maxX));
  camera.y = clamp(player.y - VIEW_HEIGHT / 2, 0, Math.max(0, maxY));
}
function gameLoop(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  let dt = (timestamp - lastTimestamp) / 1000;
  dt = Math.min(dt, 0.05);
  lastTimestamp = timestamp;

  updatePlayer(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateEffects(dt);
  updateParticles(dt);
  updateHudTimers(dt);
  updateCamera();
  render();
  updateHUD();

  justPressed.attack = false;
  justPressed.interact = false;
  justPressed.dash = false;

  requestAnimationFrame(gameLoop);
}

initializeGame();
requestAnimationFrame(gameLoop);
