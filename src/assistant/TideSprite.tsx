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
      <img src="/brand/hedgehog.png" alt="" width="80" height="80" draggable={false} />
    </span>
  );
}
