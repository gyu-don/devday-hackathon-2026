export type Category = "books" | "laundry" | "trash" | "dolls";
export type Item = { id: string; label: string; category: Category; stored: boolean };
export type RoomState = { items: Item[]; selected: string | null; ready: boolean };
export type { Assessment } from "@devday/contracts";

export const destinations: {
  id: Category;
  label: string;
  detail: string;
  icon: string;
  key: string;
}[] = [
  { id: "books", label: "本棚", detail: "本・ノート", icon: "book", key: "1" },
  {
    id: "laundry",
    label: "ランドリーバスケット",
    detail: "脱ぎっぱなしの服",
    icon: "basket",
    key: "2",
  },
  { id: "trash", label: "ごみ箱", detail: "空き缶・紙くず", icon: "trash", key: "3" },
  { id: "dolls", label: "人形の飾り台", detail: "大切なプリキュア人形", icon: "heart", key: "4" },
];
