// Combine legacy scene documents once. Record identity wins over array position;
// conflicting revisions stay intact in the migration recovery snapshot.
export function mergeSharedData(first: unknown, next: unknown, preferNext = false): unknown {
  if (first === undefined || first === null || first === "") return next;
  if (next === undefined || next === null || next === "") return first;
  if (Array.isArray(first) && Array.isArray(next)) {
    const result = [...first];
    for (const value of next) {
      const id = value && typeof value === "object" ? value.id : undefined;
      const index = result.findIndex(item => id !== undefined
        ? item && typeof item === "object" && item.id === id
        : JSON.stringify(item) === JSON.stringify(value));
      if (index < 0) result.push(value);
      else if (id !== undefined && (preferNext || String(value.updatedAt ?? value.updated_at ?? "") > String(result[index].updatedAt ?? result[index].updated_at ?? ""))) result[index] = value;
    }
    return result;
  }
  if (typeof first === "object" && !Array.isArray(first) && typeof next === "object" && !Array.isArray(next)) {
    // A drawing is an indivisible snapshot, including dimensions and cells.
    if ("cells" in first && "palette" in first) return preferNext ? next : first;
    const result: Record<string, unknown> = { ...first };
    for (const [key, value] of Object.entries(next)) result[key] = mergeSharedData(result[key], value, preferNext);
    return result;
  }
  return preferNext ? next : first;
}
