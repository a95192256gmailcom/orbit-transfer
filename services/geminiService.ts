
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getFileInsight = async (fileName: string, fileType: string, fileSize: number): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Provide a very short, professional 1-sentence description or categorization for this file: ${fileName} (${fileType}, ${Math.round(fileSize / 1024)}KB). If it's a known format, explain its common use.`,
      config: {
        maxOutputTokens: 100,
        temperature: 0.7,
      },
    });
    return response.text || "Standard file transfer.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "File processed successfully.";
  }
};
