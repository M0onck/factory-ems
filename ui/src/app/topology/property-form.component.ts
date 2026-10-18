import { Component, EventEmitter, Input, OnChanges, Output } from "@angular/core";
import { FormGroup, ReactiveFormsModule } from "@angular/forms";
import { FormlyFieldConfig, FormlyModule } from "@ngx-formly/core";
import { PropertyDefinition } from "./topology.factory-schema";

/**
 * 通用属性表单：输入属性定义数组，动态生成 @ngx-formly 表单，
 * 输出编辑后的 `{ [id]: value }` 对象。
 *
 * 不针对具体设备写死字段，只根据 `type` 把属性映射到 formly 字段类型。
 */
@Component({
    selector: "app-property-form",
    standalone: true,
    imports: [ReactiveFormsModule, FormlyModule],
    template: `<formly-form [form]="form" [fields]="fields" [model]="model" (modelChange)="onModelChange($event)" />`,
})
export class PropertyFormComponent implements OnChanges {
    @Input()
    public properties: PropertyDefinition[] = [];

    /** 编辑后的 { [id]: value } */
    @Output()
    public valueChange = new EventEmitter<{ [id: string]: unknown }>();

    protected form: FormGroup = new FormGroup({});
    protected model: Record<string, unknown> = {};
    protected fields: FormlyFieldConfig[] = [];

    public ngOnChanges(): void {
        this.fields = this.properties.map((property) => this.toField(property));
        this.model = this.buildModel(this.properties);
        this.form = new FormGroup({});
    }

    protected onModelChange(model: unknown): void {
        this.valueChange.emit(model as { [id: string]: unknown });
    }

    private buildModel(properties: PropertyDefinition[]): Record<string, unknown> {
        const model: Record<string, unknown> = {};
        for (const property of properties) {
            model[property.id] = property.default ?? null;
        }
        return model;
    }

    private toField(property: PropertyDefinition): FormlyFieldConfig {
        const baseProps: Record<string, unknown> = {
            label: property.name,
            required: property.required,
        };

        switch (property.type) {
            case "BOOLEAN":
                return { key: property.id, type: "checkbox-button", props: baseProps };
            case "SELECT":
                return {
                    key: property.id,
                    type: "select",
                    props: {
                        ...baseProps,
                        options: (property.options ?? []).map((option) => ({ label: option.label, value: option.value })),
                    },
                };
            case "INTEGER":
            case "LONG":
            case "SHORT":
                return {
                    key: property.id,
                    type: "input",
                    props: { ...baseProps, type: "number", step: 1 },
                };
            case "FLOAT":
            case "DOUBLE":
                return {
                    key: property.id,
                    type: "input",
                    props: { ...baseProps, type: "number", step: 0.01 },
                };
            case "STRING":
            default:
                return { key: property.id, type: "input", props: baseProps };
        }
    }
}
