// Phrases no generated crew name may contain, checked against every pattern × word combination
// when a snapshot is built (ARCHITECTURE.md §9). Matching is case-insensitive on whole words,
// after collapsing punctuation to spaces.
//
// This list is a placeholder for the mechanism. Before the site goes public, replace it with a
// maintained list of slurs and offensive phrases (kept server-side; it never ships to browsers).
export const DENIED_PHRASES: readonly string[] = [
  'nazi',
  'kkk',
  'white power',
  'rape',
]
