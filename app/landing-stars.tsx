// Discrete DOM nodes so a later Figma Motion pass can address each dot.
const BAND_COLS = 16;
const BAND_ROWS = 14;

type Dot = {
  left: string;
  top: string;
  delay: string;
  duration: string;
};

function hashUnit(index: number, salt: number) {
  const n = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function buildDots(): Dot[] {
  const dots: Dot[] = [];
  let index = 0;
  for (let row = 0; row < BAND_ROWS; row += 1) {
    for (let col = 0; col < BAND_COLS; col += 1) {
      const left = ((col + hashUnit(index, 3)) / BAND_COLS) * 100;
      const top = ((row + hashUnit(index, 4)) / BAND_ROWS) * 100;
      dots.push({
        left: `${left.toFixed(3)}%`,
        top: `${top.toFixed(3)}%`,
        delay: `${(hashUnit(index, 1) * 8).toFixed(2)}s`,
        duration: `${(4.5 + hashUnit(index, 2) * 5.5).toFixed(2)}s`,
      });
      index += 1;
    }
  }
  return dots;
}

const DOTS = buildDots();

export function LandingStars() {
  return (
    <div
      className="landing-stars"
      aria-hidden="true"
      data-dot-count={DOTS.length}
    >
      {DOTS.map((dot, index) => (
        <div
          key={index}
          className="landing-dot"
          style={{
            left: dot.left,
            top: dot.top,
            animationDelay: dot.delay,
            animationDuration: dot.duration,
          }}
        />
      ))}
    </div>
  );
}
