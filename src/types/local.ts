/** Mirror of the Rust `LocalEntry` struct. */
export interface LocalEntry {
  name: string;
  path: string;
  entry_type: "File" | "Directory";
  size: number;
  modified: number | null;
  permissions: number | null;
  permissions_display: string | null;
  is_symlink: boolean;
}
