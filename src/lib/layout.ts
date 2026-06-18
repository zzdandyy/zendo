/**
 * Shared layout constants — single source of truth for the terminal area margins.
 *
 * These match the Tailwind classes used in AppShell and terminal wrappers:
 *   - Outer container:  `p-2.5`
 *   - Split container:  `gap-0` + SplitHandle `w-2.5`/`h-2.5`
 */
export const TERMINAL_MARGIN = 10; // p-2.5
export const SPLIT_GAP = 10;       // w-2.5 / h-2.5 on SplitHandle
