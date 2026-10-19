import { Component, EventEmitter, Input, OnChanges, Output } from "@angular/core";
import { FormGroup, ReactiveFormsModule } from "@angular/forms";
import { FormlyFieldConfig, FormlyModule } from "@ngx-formly/core";
import { PropertyDefinition } from "./topology.factory-schema";

/**
 * 通用属性表单：输入属性定义数组，动态生成 @ngx-formly 表单，输出编辑后的 `{ [id]: value }` 对象。
 *
 * 不针对具体设备写死字段，只根据 `type` 把属性映射到 formly 字段类型。 属性 id 中的 `.`（如 `ess.id`）会被替换为 `_` 作为表单 key，避免被 formly 当作嵌套路径。
 * REPEAT（数组）类型以逗号分隔文本编辑，提交时再转回数组。
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
        const raw = model as Record<string, unknown>;
        const result: { [id: string]: unknown } = {};
        for (const property of this.properties) {
            const value = raw[this.formKey(property.id)];
            result[property.id] =
                property.type === "REPEAT" ? this.fromRepeatString(value, property.repeatOf ?? "STRING") : value;
        }
        this.valueChange.emit(result);
    }

    private buildModel(properties: PropertyDefinition[]): Record<string, unknown> {
        const model: Record<string, unknown> = {};
        for (const property of properties) {
            model[this.formKey(property.id)] =
                property.type === "REPEAT" ? this.toRepeatString(property.default) : (property.default ?? null);
        }
        return model;
    }

    private formKey(propertyId: string): string {
        return propertyId.replace(/\./g, "_");
    }

    private toRepeatString(value: unknown): string {
        if (Array.isArray(value)) {
            return value.map((item) => String(item)).join(", ");
        }
        if (value == null || value === "") {
            return "";
        }
        return String(value);
    }

    private fromRepeatString(value: unknown, repeatOf: "STRING" | "INTEGER"): unknown[] {
        if (Array.isArray(value)) {
            return value;
        }
        if (value == null || value === "") {
            return [];
        }
        const items = String(value)
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== "");
        return repeatOf === "INTEGER" ? items.map((item) => Number(item)) : items;
    }

    private toField(property: PropertyDefinition): FormlyFieldConfig {
        const key = this.formKey(property.id);
        const baseProps: Record<string, unknown> = {
            label: property.name,
            required: property.required,
        };
        if (property.hint != null && property.hint !== "") {
            baseProps["description"] = property.hint;
        }

        switch (property.type) {
            case "BOOLEAN":
                return { key, type: "checkbox-button", props: baseProps };
            case "SELECT":
                return {
                    key,
                    type: "select",
                    props: {
                        ...baseProps,
                        options: (property.options ?? []).map((option) => ({
                            label: option.label,
                            value: option.value,
                        })),
                    },
                };
            case "INTEGER":
            case "LONG":
            case "SHORT":
                return {
                    key,
                    type: "input",
                    props: { ...baseProps, type: "number", step: 1 },
                };
            case "FLOAT":
            case "DOUBLE":
                return {
                    key,
                    type: "input",
                    props: { ...baseProps, type: "number", step: 0.01 },
                };
            case "REPEAT":
            case "STRING":
            default:
                return { key, type: "input", props: baseProps };
        }
    }
}
