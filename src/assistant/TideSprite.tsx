export default function TideSprite({
  color = "sea",
  active = false,
}: {
  color?: "sea" | "sunset";
  active?: boolean;
}) {
  return (
    <span
      className={`tide-sprite tide-sprite-${color}${active ? " is-awake" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 80 80" fill="none">
        <ellipse
          cx="40"
          cy="70"
          rx="22"
          ry="3"
          fill="currentColor"
          opacity=".12"
        />
        <path
          className="tide-body"
          d="M40 9C35 21 14 33 14 49C14 64 26 69 40 69C54 69 66 64 66 49C66 34 48 25 40 9Z"
          fill="currentColor"
        />
        <path
          d="M18 48C29 39 39 57 63 46V52C61 65 50 67 40 67C27 67 18 62 18 48Z"
          fill="white"
          opacity=".2"
        />
        <path
          d="M29 43L29 47M49 43L49 47"
          stroke="#193f47"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M35 51Q40 55 45 51"
          stroke="#193f47"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="25" cy="51" r="3" fill="#ffe4d5" opacity=".65" />
        <circle cx="55" cy="51" r="3" fill="#ffe4d5" opacity=".65" />
        <path
          d="M27 32L31 28"
          stroke="white"
          opacity=".7"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
