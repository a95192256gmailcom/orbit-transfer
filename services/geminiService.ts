
import { GoogleGenAI } from "@google/genai";

// Initialize the GoogleGenAI client with the API key from environment variables.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getFileInsight = async (fileName: string, fileType: string, fileSize: number): Promise<string> => {
  try {
    // Generate content using the recommended model for basic text tasks.
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Provide a very short, professional 1-sentence description or categorization for this file: ${fileName} (${fileType}, ${Math.round(fileSize / 1024)}KB). If it's a known format, explain its common use.`,
      config: {
        // Removed maxOutputTokens to prevent potential generation blocking issues.
        temperature: 0.7,
      },
    });
    // Use the .text property directly as it is a getter.
    return response.text || "Standard file transfer.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "File processed successfully.";
  }
};
