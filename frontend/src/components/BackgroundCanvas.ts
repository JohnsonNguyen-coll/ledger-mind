interface AgentNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

interface FallingCoin {
  x: number;
  y: number;
  vy: number;
  vx: number;
  size: number;
  symbol: string;
  color: string;
  rotation: number;
  rotSpeed: number;
}

export function initBackgroundCanvas(canvasId = 'bg-canvas') {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const context = ctx;

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  // Create Agent Nodes
  const nodeCount = 30;
  const nodes: AgentNode[] = [];
  const colors = ['#00E5FF', '#00F5A0', '#3B82F6'];

  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      radius: Math.random() * 2 + 1.5,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }

  // Create Falling Crypto Coins (BTC ₿, ETH Ξ, SOL ◎, USDC $)
  const coinCount = 22;
  const coinSymbols = [
    { symbol: '₿', color: '#FFB800' }, // BTC Gold
    { symbol: 'Ξ', color: '#00E5FF' }, // ETH Cyan
    { symbol: '◎', color: '#3B82F6' }, // SOL Blue
    { symbol: '$', color: '#00F5A0' }, // USDC Emerald
  ];

  const coins: FallingCoin[] = [];
  for (let i = 0; i < coinCount; i++) {
    const coinType = coinSymbols[Math.floor(Math.random() * coinSymbols.length)];
    coins.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vy: Math.random() * 1.2 + 0.6,
      vx: (Math.random() - 0.5) * 0.4,
      size: Math.random() * 10 + 16,
      symbol: coinType.symbol,
      color: coinType.color,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.02,
    });
  }

  function render() {
    context.clearRect(0, 0, width, height);

    // 1. Draw Laser Network Lines between Agent Nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 140) {
          const alpha = (1 - dist / 140) * 0.18;
          context.beginPath();
          context.moveTo(nodes[i].x, nodes[i].y);
          context.lineTo(nodes[j].x, nodes[j].y);
          context.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
          context.lineWidth = 1;
          context.stroke();
        }
      }
    }

    // 2. Draw & Update Agent Nodes
    for (const node of nodes) {
      node.x += node.vx;
      node.y += node.vy;

      if (node.x < 0 || node.x > width) node.vx *= -1;
      if (node.y < 0 || node.y > height) node.vy *= -1;

      context.beginPath();
      context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      context.fillStyle = node.color;
      context.fill();
    }

    // 3. Draw & Update Falling Crypto Coins
    for (const coin of coins) {
      coin.y += coin.vy;
      coin.x += coin.vx;
      coin.rotation += coin.rotSpeed;

      if (coin.y > height + 40) {
        coin.y = -40;
        coin.x = Math.random() * width;
      }
      if (coin.x < -40) coin.x = width + 40;
      if (coin.x > width + 40) coin.x = -40;

      context.save();
      context.translate(coin.x, coin.y);
      context.rotate(coin.rotation);

      // Draw Coin Badge Circle
      context.beginPath();
      context.arc(0, 0, coin.size, 0, Math.PI * 2);
      context.fillStyle = '#121A26';
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = coin.color;
      context.stroke();

      // Draw Symbol Inside Coin
      context.fillStyle = coin.color;
      context.font = `bold ${Math.floor(coin.size * 1.1)}px 'JetBrains Mono', monospace`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(coin.symbol, 0, 1);

      context.restore();
    }

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}
