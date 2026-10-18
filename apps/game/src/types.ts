export type Category = "books" | "laundry" | "trash" | "dolls";
export type Item = { id: string; label: string; category: Category; placed: boolean };
export type RoomState = { items: Item[]; selected: string | null; ready: boolean };
export type Placement = { x: number; y: number; z: number };
export type { Assessment } from "@devday/contracts";
