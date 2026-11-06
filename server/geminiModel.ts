import {ThinkingLevel,type GenerateContentConfig} from '@google/genai';

export const GEMINI_MODEL='gemini-3.8-flash';
export const GEMINI_THINKING_CONFIG={thinkingLevel:ThinkingLevel.LOW};

/** Gemini 3.8 uses reasoning levels, not the old token budget or sampling knobs.
 * Keep the existing schemas, limits, cancellation and one-attempt transport. */
export function geminiModelConfig(config:Record<string,any>={}):GenerateContentConfig {
  const {temperature:_temperature,topP:_topP,topK:_topK,candidateCount:_candidateCount,thinkingConfig:_oldThinking,...rest}=config;
  return {...rest,thinkingConfig:{...GEMINI_THINKING_CONFIG}};
}
