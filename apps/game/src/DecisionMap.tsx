import type { AutoDecision } from "@devday/contracts";
import { roomGridRows, roomGridColumns, roomRegionCount } from "@devday/contracts";

export function DecisionMap({ decision }: { decision: AutoDecision }) {
  return (
    <div className="decision-map">
      <div
        className="decision-map-scroll"
        role="region"
        aria-label="200区画の確率マップ。横にスクロールできます"
        tabIndex={0}
      >
        <table>
          <caption>AIが見ている片付け優先度 · {roomRegionCount}区画</caption>
          <thead>
            <tr>
              <th scope="col">奥↓手前</th>
              {Array.from({ length: roomGridColumns }, (_, index) => (
                <th scope="col" key={index}>
                  {index + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: roomGridRows }, (_, index) =>
              String.fromCharCode(65 + index),
            ).map((row, index) => (
              <tr key={row}>
                <th scope="row">{row}</th>
                {decision.regions
                  .slice(index * roomGridColumns, (index + 1) * roomGridColumns)
                  .map((region) => (
                    <td
                      key={region.id}
                      className={region.id === decision.sourceRegion ? "decision-focus" : ""}
                      style={{
                        backgroundColor: `rgba(184, 81, 55, ${0.05 + region.needsTidyingProbability * 0.25})`,
                      }}
                    >
                      <span>{region.id}</span>
                      <strong>{Math.round(region.needsTidyingProbability * 100)}%</strong>
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        注目区画 {decision.sourceRegion} · 配置候補の改善見込み{" "}
        {Math.round(decision.improvementProbability * 100)}%
      </p>
      <small>
        左1→右20、奥A→手前J。横にスクロールできます。区画の数値は「片付けが必要」の推定です。改善見込みは実行前の予測で、実行後の画像判定とは別です。
      </small>
    </div>
  );
}
