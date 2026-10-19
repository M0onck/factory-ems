import { Component } from "@angular/core";
import { CONTROL_BADGE, DEVICE_TYPE_VISUAL, EDGE_SEMANTIC_VISUAL, MEASURE_BADGE, UNKNOWN_TYPE_VISUAL, } from "./topology.visual";

/** 可折叠的拓扑图例：内容从 topology.visual.ts 的同一份视觉常量渲染，保证与画布一致。 */
@Component({
    selector: "app-topology-legend",
    standalone: true,
    template: `
        <div class="legend" [class.collapsed]="!expanded">
            @if (expanded) {
                <div class="legend-panel">
                    <div class="legend-header">
                        <span class="legend-title">图例</span>
                        <button type="button" class="legend-collapse" (click)="toggle()">收起</button>
                    </div>
                    <section class="legend-section">
                        <h4 class="legend-heading">设备类型</h4>
                        @for (type of deviceTypes; track type.label) {
                            <div class="legend-row">
                                <span class="swatch" [style.background]="type.color">{{ type.icon }}</span>
                                <span class="legend-text">{{ type.label }}</span>
                            </div>
                        }
                    </section>
                    <section class="legend-section">
                        <h4 class="legend-heading">Channel 能力</h4>
                        <div class="legend-row">
                            <span class="badge" [style.background]="measureBadge.color">{{ measureBadge.letter }}</span>
                            <span class="legend-text">{{ measureBadge.label }}</span>
                        </div>
                        <div class="legend-row">
                            <span class="badge" [style.background]="controlBadge.color">{{ controlBadge.letter }}</span>
                            <span class="legend-text">{{ controlBadge.label }}</span>
                        </div>
                    </section>
                    <section class="legend-section">
                        <h4 class="legend-heading">连线语义</h4>
                        @for (semantic of edgeSemantics; track semantic.abbreviation) {
                            <div class="legend-row">
                                <span
                                    class="edge-line"
                                    [class.dashed]="semantic.dashed"
                                    [style.border-color]="semantic.color"
                                >
                                    →
                                </span>
                                <span class="legend-text">{{ semantic.label }}（{{ semantic.description }}）</span>
                            </div>
                        }
                    </section>
                    <section class="legend-section">
                        <h4 class="legend-heading">状态与分组</h4>
                        <div class="legend-row">
                            <span class="border-sample solid"></span>
                            <span class="legend-text">实线边框 = 已部署</span>
                        </div>
                        <div class="legend-row">
                            <span class="border-sample dashed"></span>
                            <span class="legend-text">虚线边框 = 草稿</span>
                        </div>
                        <div class="legend-row">
                            <span class="border-sample group"></span>
                            <span class="legend-text">灰色虚线框 = Bridge 分组</span>
                        </div>
                    </section>
                    <section class="legend-section">
                        <h4 class="legend-heading">不在图中显示</h4>
                        <div class="legend-row">
                            <span class="legend-text"
                                >基础设施（Ess.Power、Evcs
                                过滤器、API、日志、Core、Scheduler、Timedata）不属于控制设计，默认隐藏</span
                            >
                        </div>
                    </section>
                </div>
            } @else {
                <button type="button" class="legend-toggle" (click)="toggle()">图例</button>
            }
        </div>
    `,
    styles: `
        .legend {
            position: absolute;
            left: 12px;
            top: 12px;
            z-index: 20;
            font-family: inherit;
        }

        .legend-panel {
            width: 200px;
            max-height: 360px;
            overflow-y: auto;
            background: #ffffff;
            border: 1px solid #e8e8e8;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
            padding: 10px 12px;
        }

        .legend-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }

        .legend-title {
            font-size: 13px;
            font-weight: 600;
            color: #262626;
        }

        .legend-collapse,
        .legend-toggle {
            border: 1px solid #d9d9d9;
            background: #ffffff;
            border-radius: 4px;
            font-size: 12px;
            padding: 2px 8px;
            cursor: pointer;
            color: #595959;
        }

        .legend-toggle {
            padding: 4px 12px;
        }

        .legend-collapse:hover,
        .legend-toggle:hover {
            border-color: #1677ff;
            color: #1677ff;
        }

        .legend-section {
            border-top: 1px solid #f0f0f0;
            padding-top: 6px;
            margin-top: 6px;
        }

        .legend-heading {
            margin: 0 0 4px;
            font-size: 12px;
            font-weight: 600;
            color: #595959;
        }

        .legend-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 3px 0;
        }

        .legend-text {
            font-size: 11px;
            color: #595959;
        }

        .swatch {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            border-radius: 4px;
            color: #ffffff;
            font-size: 11px;
            flex-shrink: 0;
        }

        .badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            color: #ffffff;
            font-size: 9px;
            font-weight: 700;
            flex-shrink: 0;
        }

        .edge-line {
            display: inline-flex;
            align-items: center;
            width: 20px;
            border-top: 2px solid;
            flex-shrink: 0;
            font-size: 10px;
            color: transparent;
        }

        .edge-line.dashed {
            border-top-style: dashed;
        }

        .border-sample {
            display: inline-block;
            width: 20px;
            height: 0;
            border-top: 2px solid #b0b0b0;
            flex-shrink: 0;
        }

        .border-sample.dashed {
            border-top-style: dashed;
        }

        .border-sample.group {
            border-top-color: #bdbdbd;
            border-top-style: dashed;
        }
    `,
})
export class LegendComponent {
    protected expanded = true;
    protected deviceTypes = [
        ...DEVICE_TYPE_VISUAL.map((entry) => ({ color: entry.color, icon: entry.icon, label: entry.label })),
        UNKNOWN_TYPE_VISUAL,
    ];
    protected measureBadge = MEASURE_BADGE;
    protected controlBadge = CONTROL_BADGE;
    protected edgeSemantics = [EDGE_SEMANTIC_VISUAL.MEASUREMENT, EDGE_SEMANTIC_VISUAL.CONTROL];

    protected toggle(): void {
        this.expanded = !this.expanded;
    }
}
