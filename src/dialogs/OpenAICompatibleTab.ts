import type { Model } from "@earendil-works/pi-ai";
import { type CustomProvider, getAppStorage, SettingsTab } from "@earendil-works/pi-web-ui";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Checkbox } from "@mariozechner/mini-lit/dist/Checkbox.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { html, type TemplateResult } from "lit";
import { Toast } from "../components/Toast.js";

type OpenAICompatibleModel = Model<"openai-completions">;

type OpenAICompatibleProvider = CustomProvider & {
	type: "openai-completions";
	models: OpenAICompatibleModel[];
};

interface ModelDraft {
	id: string;
	contextWindow: string;
	maxTokens: string;
	inputCost: string;
	outputCost: string;
	cacheReadCost: string;
	cacheWriteCost: string;
	reasoning: boolean;
	vision: boolean;
}

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 8192;

const normalizeBaseUrl = (url: string) => url.trim().replace(/\/+$/, "");

const parsePositiveNumber = (value: string, fallback: number) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const createEmptyModelDraft = (): ModelDraft => ({
	id: "",
	contextWindow: String(DEFAULT_CONTEXT_WINDOW),
	maxTokens: String(DEFAULT_MAX_TOKENS),
	inputCost: "0",
	outputCost: "0",
	cacheReadCost: "0",
	cacheWriteCost: "0",
	reasoning: false,
	vision: false,
});

const createModelDraft = (model: OpenAICompatibleModel): ModelDraft => ({
	id: model.id,
	contextWindow: String(model.contextWindow || DEFAULT_CONTEXT_WINDOW),
	maxTokens: String(model.maxTokens || DEFAULT_MAX_TOKENS),
	inputCost: String(model.cost.input || 0),
	outputCost: String(model.cost.output || 0),
	cacheReadCost: String(model.cost.cacheRead || 0),
	cacheWriteCost: String(model.cost.cacheWrite || 0),
	reasoning: model.reasoning,
	vision: model.input.includes("image"),
});

const createModel = (providerName: string, baseUrl: string, draft: ModelDraft): OpenAICompatibleModel => {
	const reasoning = draft.reasoning;
	return {
		id: draft.id.trim(),
		name: draft.id.trim(),
		api: "openai-completions",
		provider: providerName.trim(),
		baseUrl: normalizeBaseUrl(baseUrl),
		reasoning,
		input: draft.vision ? ["text", "image"] : ["text"],
		cost: {
			input: parsePositiveNumber(draft.inputCost, 0),
			output: parsePositiveNumber(draft.outputCost, 0),
			cacheRead: parsePositiveNumber(draft.cacheReadCost, 0),
			cacheWrite: parsePositiveNumber(draft.cacheWriteCost, 0),
		},
		contextWindow: parsePositiveNumber(draft.contextWindow, DEFAULT_CONTEXT_WINDOW),
		maxTokens: parsePositiveNumber(draft.maxTokens, DEFAULT_MAX_TOKENS),
		compat: {
			maxTokensField: "max_tokens",
			supportsDeveloperRole: false,
			supportsReasoningEffort: reasoning,
			supportsStore: false,
		},
	};
};

export class OpenAICompatibleTab extends SettingsTab {
	private providers: OpenAICompatibleProvider[] = [];
	private editingId = "";
	private name = "";
	private baseUrl = "";
	private apiKey = "";
	private modelDrafts: ModelDraft[] = [createEmptyModelDraft()];

	getTabName(): string {
		return "OpenAI Compatible";
	}

	override async connectedCallback() {
		super.connectedCallback();
		await this.loadProviders();
	}

	private async loadProviders() {
		const providers = await getAppStorage().customProviders.getAll();
		this.providers = providers.filter(
			(provider): provider is OpenAICompatibleProvider =>
				provider.type === "openai-completions" && !!provider.models?.length,
		);
		this.requestUpdate();
	}

	private resetForm() {
		this.editingId = "";
		this.name = "";
		this.baseUrl = "";
		this.apiKey = "";
		this.modelDrafts = [createEmptyModelDraft()];
		this.requestUpdate();
	}

	private editProvider(provider: OpenAICompatibleProvider) {
		this.editingId = provider.id;
		this.name = provider.name;
		this.baseUrl = provider.baseUrl;
		this.apiKey = provider.apiKey || "";
		this.modelDrafts = provider.models.length > 0 ? provider.models.map(createModelDraft) : [createEmptyModelDraft()];
		this.requestUpdate();
	}

	private updateModelDraft(index: number, update: Partial<ModelDraft>) {
		this.modelDrafts = this.modelDrafts.map((draft, draftIndex) =>
			draftIndex === index ? { ...draft, ...update } : draft,
		);
		this.requestUpdate();
	}

	private addModelDraft() {
		this.modelDrafts = [...this.modelDrafts, createEmptyModelDraft()];
		this.requestUpdate();
	}

	private removeModelDraft(index: number) {
		if (this.modelDrafts.length === 1) return;
		this.modelDrafts = this.modelDrafts.filter((_, draftIndex) => draftIndex !== index);
		this.requestUpdate();
	}

	private async saveProvider() {
		const name = this.name.trim();
		const baseUrl = normalizeBaseUrl(this.baseUrl);
		const modelDrafts = this.modelDrafts.filter((draft) => draft.id.trim());
		if (!name || !baseUrl || modelDrafts.length === 0) return;

		const duplicateProvider = this.providers.find(
			(provider) => provider.name === name && provider.id !== this.editingId,
		);
		if (duplicateProvider) {
			Toast.error("Provider name already exists");
			return;
		}

		const modelIds = modelDrafts.map((draft) => draft.id.trim());
		if (new Set(modelIds).size !== modelIds.length) {
			Toast.error("Model IDs must be unique");
			return;
		}

		const provider: OpenAICompatibleProvider = {
			id: this.editingId || crypto.randomUUID(),
			name,
			type: "openai-completions",
			baseUrl,
			apiKey: this.apiKey.trim() || undefined,
			models: modelDrafts.map((draft) => createModel(name, baseUrl, draft)),
		};

		await getAppStorage().customProviders.set(provider);
		Toast.success("OpenAI-compatible provider saved");
		this.resetForm();
		await this.loadProviders();
	}

	private async deleteProvider(provider: OpenAICompatibleProvider) {
		await getAppStorage().customProviders.delete(provider.id);
		if (this.editingId === provider.id) this.resetForm();
		await this.loadProviders();
	}

	private renderNumberInput(label: string, value: string, onInput: (value: string) => void): TemplateResult {
		return html`
			<label class="flex flex-col gap-1 text-xs text-muted-foreground">
				<span>${label}</span>
				${Input({
					type: "number",
					value,
					onInput: (event: Event) => {
						onInput((event.target as HTMLInputElement).value);
					},
				})}
			</label>
		`;
	}

	private renderModelDraft(draft: ModelDraft, index: number): TemplateResult {
		return html`
			<div class="flex flex-col gap-3 p-3 rounded-md border border-border/70">
				<div class="flex items-center justify-between gap-2">
					<div class="text-sm font-medium text-foreground">Model ${index + 1}</div>
					${
						this.modelDrafts.length > 1
							? Button({
									variant: "ghost",
									size: "sm",
									onClick: () => this.removeModelDraft(index),
									children: "Remove",
								})
							: ""
					}
				</div>
				${Input({
					value: draft.id,
					placeholder: "Model ID, e.g. gpt-4o-mini or company/claude-sonnet",
					onInput: (event: Event) => {
						this.updateModelDraft(index, { id: (event.target as HTMLInputElement).value });
					},
				})}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
					${this.renderNumberInput("Context window", draft.contextWindow, (contextWindow) =>
						this.updateModelDraft(index, { contextWindow }),
					)}
					${this.renderNumberInput("Max output tokens", draft.maxTokens, (maxTokens) =>
						this.updateModelDraft(index, { maxTokens }),
					)}
					${this.renderNumberInput("Input cost ($/1M tokens)", draft.inputCost, (inputCost) =>
						this.updateModelDraft(index, { inputCost }),
					)}
					${this.renderNumberInput("Output cost ($/1M tokens)", draft.outputCost, (outputCost) =>
						this.updateModelDraft(index, { outputCost }),
					)}
					${this.renderNumberInput("Cache read cost ($/1M tokens)", draft.cacheReadCost, (cacheReadCost) =>
						this.updateModelDraft(index, { cacheReadCost }),
					)}
					${this.renderNumberInput("Cache write cost ($/1M tokens)", draft.cacheWriteCost, (cacheWriteCost) =>
						this.updateModelDraft(index, { cacheWriteCost }),
					)}
				</div>
				<div class="flex flex-col gap-2 text-sm text-foreground">
					${Checkbox({
						checked: draft.reasoning,
						label: "Supports reasoning",
						onChange: (reasoning) => this.updateModelDraft(index, { reasoning }),
					})}
					${Checkbox({
						checked: draft.vision,
						label: "Supports image input",
						onChange: (vision) => this.updateModelDraft(index, { vision }),
					})}
				</div>
			</div>
		`;
	}

	private renderProvider(provider: OpenAICompatibleProvider): TemplateResult {
		const models = provider.models;
		const modelNames = models.map((model) => model.id).join(", ");
		return html`
			<div class="flex items-center justify-between p-4 rounded-lg border border-border bg-card gap-3">
				<div class="min-w-0">
					<div class="text-sm font-medium text-foreground truncate">${provider.name}</div>
					<div class="text-xs text-muted-foreground truncate">${models.length} model(s) · ${provider.baseUrl}</div>
					<div class="text-xs text-muted-foreground truncate">${modelNames}</div>
				</div>
				<div class="flex gap-2 shrink-0">
					${Button({ variant: "outline", size: "sm", onClick: () => this.editProvider(provider), children: "Edit" })}
					${Button({ variant: "ghost", size: "sm", onClick: () => this.deleteProvider(provider), children: "Delete" })}
				</div>
			</div>
		`;
	}

	render(): TemplateResult {
		const hasModel = this.modelDrafts.some((draft) => draft.id.trim());
		return html`
			<div class="flex flex-col gap-6">
				<div>
					<h3 class="text-sm font-semibold text-foreground mb-2">OpenAI-compatible provider</h3>
					<p class="text-sm text-muted-foreground">
						Add LiteLLM, vLLM, LM Studio, or any server exposing OpenAI Chat Completions. Base URL should include
						<code>/v1</code> when your server requires it. Costs are USD per 1M tokens; leave 0 for unknown or free.
					</p>
				</div>

				<div class="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card">
					${Input({
						value: this.name,
						placeholder: "Provider name, e.g. Company LiteLLM",
						onInput: (event: Event) => {
							this.name = (event.target as HTMLInputElement).value;
							this.requestUpdate();
						},
					})}
					${Input({
						value: this.baseUrl,
						placeholder: "Base URL, e.g. https://litellm.company.com/v1",
						onInput: (event: Event) => {
							this.baseUrl = (event.target as HTMLInputElement).value;
							this.requestUpdate();
						},
					})}
					${Input({
						type: "password",
						value: this.apiKey,
						placeholder: "API key",
						onInput: (event: Event) => {
							this.apiKey = (event.target as HTMLInputElement).value;
							this.requestUpdate();
						},
					})}

					<div class="flex items-center justify-between pt-2">
						<div class="text-sm font-semibold text-foreground">Models</div>
						${Button({ variant: "outline", size: "sm", onClick: () => this.addModelDraft(), children: "Add model" })}
					</div>
					${this.modelDrafts.map((draft, index) => this.renderModelDraft(draft, index))}

					<div class="flex justify-end gap-2">
						${this.editingId ? Button({ variant: "ghost", onClick: () => this.resetForm(), children: "Cancel" }) : ""}
						${Button({
							variant: "default",
							disabled: !this.name.trim() || !this.baseUrl.trim() || !hasModel,
							onClick: () => this.saveProvider(),
							children: this.editingId ? "Save changes" : "Add provider",
						})}
					</div>
				</div>

				<div class="flex flex-col gap-3">
					${this.providers.map((provider) => this.renderProvider(provider))}
				</div>
			</div>
		`;
	}
}

if (!customElements.get("openai-compatible-tab")) {
	customElements.define("openai-compatible-tab", OpenAICompatibleTab);
}
