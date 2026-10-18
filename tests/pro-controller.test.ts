import { describe, expect, it } from "vitest";
import { parseProReport } from "../apps/game/src/pro-controller.ts";

describe("プロコン1の標準入力", () => {
  it("短いレポートと IMU を含まないモードを無視する", () => {
    expect(parseProReport(0x30, new DataView(new ArrayBuffer(20)))).toBeNull();
    expect(parseProReport(0x3f, new DataView(new ArrayBuffer(48)))).toBeNull();
  });

  it("3つの符号付き IMU サンプルを平均し、A と＋ボタンを読み取る", () => {
    const data = new DataView(new ArrayBuffer(48));
    data.setUint8(2, 0x08);
    data.setUint8(3, 0x02);
    data.setUint8(6, 0x08);
    data.setUint8(7, 0x80);
    for (const [offset, value] of [
      [18, -300],
      [30, 0],
      [42, 300],
    ]) {
      data.setInt16(offset!, value!, true);
      data.setInt16(offset! + 4, 600, true);
    }
    expect(parseProReport(0x30, data)).toEqual({
      buttons: 0x08,
      plus: true,
      gyro: { x: 0, z: 600 },
      stick: { x: 0, y: 0 },
    });
  });

  it("12bit のスティック値を左右上下に復号し、中央付近の揺れを除去する", () => {
    const data = new DataView(new ArrayBuffer(48));
    const setStick = (x: number, y: number) => {
      data.setUint8(5, x & 0xff);
      data.setUint8(6, (x >> 8) | ((y & 0x0f) << 4));
      data.setUint8(7, y >> 4);
    };
    setStick(2040, 2100);
    expect(parseProReport(0x30, data)?.stick).toEqual({ x: 0, y: 0 });
    setStick(4095, 0);
    expect(parseProReport(0x30, data)?.stick).toEqual({ x: 1, y: -1 });
    setStick(0, 4095);
    expect(parseProReport(0x30, data)?.stick).toEqual({ x: -1, y: 1 });
  });
});
