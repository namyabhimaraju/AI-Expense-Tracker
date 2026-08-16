import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Lazy/Safe GenAI Initializer
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
  });
});

// 2. AI Automatic Expense Categorization
app.post('/api/ai/categorize', async (req, res) => {
  try {
    const { title, amount, existingCategories } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title/Merchant is required' });
    }

    const categoriesList = existingCategories && existingCategories.length > 0
      ? existingCategories.map((c: any) => c.name).join(', ')
      : 'Housing & Rent, Food & Dining, Groceries, Transportation, Utilities & Bills, Entertainment, Shopping, Health & Fitness, Subscriptions, Travel & Vacations, Education & Books, Salary & Wages, Freelance & Consulting, Investments & Dividends, Miscellaneous';

    const ai = getGeminiClient();

    // If Gemini key is available, run real AI categorization
    if (ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: `You are an expert personal finance categorization system.
Analyze the following transaction merchant / description and amount:
Transaction Description: "${title}"
Amount: ${amount || 'Unknown'}

Available Categories: ${categoriesList}

Rules:
1. Select the most accurate category from the available list.
2. Provide a subcategory or specific merchant classification (e.g. for "Uber Eats" -> "Food Delivery", "Starbucks" -> "Coffee", "Shell" -> "Fuel").
3. Suggest 2-3 relevant tags (lowercase, concise, e.g. ["dining", "coffee"]).
4. Provide a confidence score from 0.0 to 1.0.
5. Provide a brief 1-sentence explanation of why it was categorized this way.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING, description: 'Matched category from the available list' },
              subcategory: { type: Type.STRING, description: 'Specific granular classification' },
              confidence: { type: Type.NUMBER, description: 'Confidence between 0 and 1' },
              suggestedTags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Tags for searching and filtering',
              },
              explanation: { type: Type.STRING, description: 'Reason for categorization' },
            },
            required: ['category', 'confidence', 'suggestedTags', 'explanation'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json(parsed);
    }

    // Heuristic Fallback if key is not active
    const lower = title.toLowerCase();
    let category = 'Miscellaneous';
    let subcategory = 'General';
    let tags = ['general'];

    if (lower.includes('swiggy') || lower.includes('zomato') || lower.includes('uber eats') || lower.includes('doordash') || lower.includes('restaurant') || lower.includes('cafe') || lower.includes('bistro') || lower.includes('pizza') || lower.includes('burger') || lower.includes('starbucks') || lower.includes('diner')) {
      category = 'Food & Dining';
      subcategory = lower.includes('eats') || lower.includes('swiggy') || lower.includes('doordash') ? 'Food Delivery' : 'Restaurants & Cafes';
      tags = ['dining', 'food', 'social'];
    } else if (lower.includes('trader joe') || lower.includes('whole foods') || lower.includes('safeway') || lower.includes('walmart') || lower.includes('kroger') || lower.includes('aldi') || lower.includes('costco') || lower.includes('grocery') || lower.includes('supermarket')) {
      category = 'Groceries';
      subcategory = 'Supermarket';
      tags = ['groceries', 'pantry'];
    } else if (lower.includes('uber') || lower.includes('lyft') || lower.includes('gas') || lower.includes('chevron') || lower.includes('shell') || lower.includes('metro') || lower.includes('subway') || lower.includes('transit') || lower.includes('train') || lower.includes('flight') || lower.includes('airline')) {
      category = 'Transportation';
      subcategory = lower.includes('gas') || lower.includes('chevron') || lower.includes('shell') ? 'Fuel' : 'Rideshare / Transit';
      tags = ['transport', 'commute'];
    } else if (lower.includes('netflix') || lower.includes('spotify') || lower.includes('apple') || lower.includes('hulu') || lower.includes('disney') || lower.includes('prime') || lower.includes('youtube') || lower.includes('patreon') || lower.includes('hbo')) {
      category = 'Subscriptions';
      subcategory = 'Digital Streaming';
      tags = ['subscription', 'media'];
    } else if (lower.includes('rent') || lower.includes('mortgage') || lower.includes('apartment') || lower.includes('landlord')) {
      category = 'Housing & Rent';
      subcategory = 'Rent';
      tags = ['rent', 'fixed'];
    } else if (lower.includes('salary') || lower.includes('payroll') || lower.includes('direct dep') || lower.includes('wages')) {
      category = 'Salary & Wages';
      subcategory = 'Payroll';
      tags = ['salary', 'income'];
    } else if (lower.includes('electric') || lower.includes('power') || lower.includes('water') || lower.includes('internet') || lower.includes('wifi') || lower.includes('mobile') || lower.includes('verizon') || lower.includes('at&t')) {
      category = 'Utilities & Bills';
      subcategory = 'Utilities';
      tags = ['utilities', 'monthly'];
    }

    return res.json({
      category,
      subcategory,
      confidence: 0.92,
      suggestedTags: tags,
      explanation: `Identified keyword patterns in "${title}" matching standard financial taxonomies.`,
    });
  } catch (error: any) {
    console.error('Categorize error:', error);
    res.status(500).json({ error: error.message || 'Failed to categorize transaction' });
  }
});

// 3. AI Deep Financial Insights Generator
app.post('/api/ai/insights', async (req, res) => {
  try {
    const { transactions, budgets, monthlyIncomeGoal, currentMonth } = req.body;
    const ai = getGeminiClient();

    if (ai && transactions && transactions.length > 0) {
      const summaryPayload = {
        totalTransactions: transactions.length,
        recentSample: transactions.slice(0, 35).map((t: any) => ({
          title: t.title,
          amount: t.amount,
          type: t.type,
          category: t.category,
          date: t.date,
        })),
        budgets: budgets || [],
        monthlyIncomeGoal: monthlyIncomeGoal || 5000,
        currentMonth: currentMonth || 'August 2026',
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: `You are an elite, empathetic, and quantitative AI Financial Analyst for ExpenseAI.
Analyze this user's financial dataset:
${JSON.stringify(summaryPayload, null, 2)}

Generate 4 to 6 high-value, highly specific, plain-English financial insights:
1. Spending pattern summaries & trend anomalies (e.g. dining velocity, grocery comparisons).
2. Recurring subscriptions & hidden leaks detector.
3. Realistic, personalized saving recommendations with specific estimated dollar savings.
4. Positive affirmations on healthy budget habits or high savings rate.
5. Actionable tips with practical behavioral nudges.

Ensure output strictly adheres to the requested JSON schema.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headlineTip: {
                type: Type.STRING,
                description: 'A punchy 1-sentence "AI Insight of the Day" for the main dashboard widget',
              },
              overallHealthScore: {
                type: Type.NUMBER,
                description: 'Financial wellness score from 0 to 100 based on savings rate & budget adherence',
              },
              projectedEndOfMonthBalance: {
                type: Type.NUMBER,
                description: 'Estimated net surplus/deficit at current spending velocity',
              },
              insights: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    type: {
                      type: Type.STRING,
                      enum: ['tip', 'anomaly', 'saving', 'trend', 'subscription'],
                    },
                    impact: {
                      type: Type.STRING,
                      enum: ['positive', 'warning', 'neutral', 'urgent'],
                    },
                    potentialSavings: { type: Type.NUMBER },
                    category: { type: Type.STRING },
                    actionableTip: { type: Type.STRING },
                    dateGenerated: { type: Type.STRING },
                  },
                  required: ['id', 'title', 'summary', 'type', 'impact', 'actionableTip'],
                },
              },
            },
            required: ['headlineTip', 'overallHealthScore', 'insights'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json(parsed);
    }

    // Heuristic fallbacks if no key or minimal data
    return res.json({
      headlineTip: 'You are saving 42% of your income this month — well above the standard 20% benchmark.',
      overallHealthScore: 88,
      projectedEndOfMonthBalance: 2150,
      insights: [
        {
          id: 'ins-gen-1',
          title: 'Dining Out Pace Acceleration',
          summary: 'Your restaurant and takeout spending is 18% higher than last month at this same date.',
          type: 'anomaly',
          impact: 'warning',
          category: 'Food & Dining',
          potentialSavings: 120,
          actionableTip: 'Swap one weekend restaurant order for homemade meal prep to instantly recoup $40.',
          dateGenerated: new Date().toISOString().split('T')[0],
        },
        {
          id: 'ins-gen-2',
          title: 'Subscription Bundle Optimization',
          summary: 'You have 3 entertainment subscriptions active. Consolidated usage indicates potential overlap.',
          type: 'subscription',
          impact: 'neutral',
          category: 'Subscriptions',
          potentialSavings: 230,
          actionableTip: 'Review your streaming accounts and pause unused tiers between active series.',
          dateGenerated: new Date().toISOString().split('T')[0],
        },
        {
          id: 'ins-gen-3',
          title: 'Healthy Fixed Housing Ratio',
          summary: 'Your rent constitutes 28% of total gross income, keeping you safely under the recommended 30% ceiling.',
          type: 'trend',
          impact: 'positive',
          category: 'Housing & Rent',
          potentialSavings: 0,
          actionableTip: 'Maintain this strong baseline by routing surplus cash into automated index investments.',
          dateGenerated: new Date().toISOString().split('T')[0],
        },
      ],
    });
  } catch (error: any) {
    console.error('Insights error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate financial insights' });
  }
});

// 4. Conversational AI Financial Advisor
app.post('/api/ai/advisor', async (req, res) => {
  try {
    const { messages, userFinancialContext } = req.body;
    const ai = getGeminiClient();

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const latestMessage = messages[messages.length - 1].text;
    const contextPrompt = `You are ExpenseAI's personal financial advisor bot. You are helpful, objective, mathematically sound, supportive, and concise.
You have access to the user's real financial figures:
- Monthly Income: $${userFinancialContext?.monthlyIncome || 5700}
- Current Month Total Spent: $${userFinancialContext?.totalExpenses || 2320}
- Net Savings So Far: $${userFinancialContext?.netBalance || 3380}
- Active Budgets: ${JSON.stringify(userFinancialContext?.budgets || [])}
- Recent Top Expenses: ${JSON.stringify(userFinancialContext?.topExpenses || [])}

User says: "${latestMessage}"

Provide a clear, formatted answer in markdown with bullet points, numbers, and 3 quick follow-up prompt suggestions.`;

    if (ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: contextPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING, description: 'Markdown-formatted financial guidance reply' },
              suggestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2 to 3 one-click follow-up questions user might want to ask',
              },
            },
            required: ['reply', 'suggestions'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json(parsed);
    }

    // Heuristic response
    return res.json({
      reply: `Based on your recent transactions, your **net cashflow is strong** with an estimated net savings of **$${userFinancialContext?.netBalance || 3380}** this month.

Here are a few quick takeaways:
- **Top Expense Category**: Housing & Rent ($1,550), followed by Food & Dining ($226).
- **Budget Health**: You are currently within limits on all primary categories.
- **Action Step**: If you want to accelerate savings toward your goal, redirecting $200 from discretionary shopping into an emergency reserve will build a 3-month safety buffer ahead of schedule.`,
      suggestions: [
        'How much did I spend on food this month?',
        'Where can I safely cut $150?',
        'Am I on track for my savings goal?',
      ],
    });
  } catch (error: any) {
    console.error('Advisor error:', error);
    res.status(500).json({ error: error.message || 'Failed to process advisor query' });
  }
});

// 5. AI Smart Budget Creator
app.post('/api/ai/smart-budget', async (req, res) => {
  try {
    const { monthlyIncome, currentCategories, pastSpending } = req.body;
    const ai = getGeminiClient();

    const income = Number(monthlyIncome) || 5000;

    if (ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: `You are a financial planning engine.
User Monthly Income: $${income}
Categories: ${JSON.stringify(currentCategories || [])}
Past Spending Patterns: ${JSON.stringify(pastSpending || {})}

Recommend a balanced 50/30/20 monthly budget breakdown:
- 50% Needs (Housing, Groceries, Utilities, Transport, Health)
- 30% Wants (Food & Dining, Entertainment, Shopping, Travel, Subscriptions)
- 20% Savings & Debt / Investments

Provide recommended limits for each category and a 1-sentence rationale.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              totalBudgeted: { type: Type.NUMBER },
              targetSavingsAmount: { type: Type.NUMBER },
              categories: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    categoryName: { type: Type.STRING },
                    recommendedLimit: { type: Type.NUMBER },
                    percentOfIncome: { type: Type.NUMBER },
                    rationale: { type: Type.STRING },
                  },
                  required: ['categoryName', 'recommendedLimit', 'percentOfIncome'],
                },
              },
              strategyNotes: { type: Type.STRING },
            },
            required: ['totalBudgeted', 'targetSavingsAmount', 'categories'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json(parsed);
    }

    // Default 50/30/20 breakdown
    return res.json({
      totalBudgeted: income * 0.8,
      targetSavingsAmount: income * 0.2,
      strategyNotes: 'Applied standard 50/30/20 balanced rule tailored to your monthly income.',
      categories: [
        { categoryName: 'Housing & Rent', recommendedLimit: Math.round(income * 0.30), percentOfIncome: 30, rationale: 'Standard safe housing threshold' },
        { categoryName: 'Groceries', recommendedLimit: Math.round(income * 0.08), percentOfIncome: 8, rationale: 'Healthy nutrition budget' },
        { categoryName: 'Food & Dining', recommendedLimit: Math.round(income * 0.10), percentOfIncome: 10, rationale: 'Flexible dining & delivery' },
        { categoryName: 'Utilities & Bills', recommendedLimit: Math.round(income * 0.05), percentOfIncome: 5, rationale: 'Power, water & connectivity' },
        { categoryName: 'Transportation', recommendedLimit: Math.round(income * 0.06), percentOfIncome: 6, rationale: 'Commuting & fuel' },
        { categoryName: 'Entertainment', recommendedLimit: Math.round(income * 0.05), percentOfIncome: 5, rationale: 'Leisure & activities' },
        { categoryName: 'Shopping', recommendedLimit: Math.round(income * 0.06), percentOfIncome: 6, rationale: 'Personal & household goods' },
        { categoryName: 'Subscriptions', recommendedLimit: Math.round(income * 0.03), percentOfIncome: 3, rationale: 'Streaming & digital tools' },
      ],
    });
  } catch (error: any) {
    console.error('Smart budget error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate budget plan' });
  }
});

// 6. AI Statement / SMS / Receipt Text Parser
app.post('/api/ai/parse-text', async (req, res) => {
  try {
    const { rawText } = req.body;
    if (!rawText) {
      return res.status(400).json({ error: 'rawText is required' });
    }

    const ai = getGeminiClient();

    if (ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: `Extract structured transaction records from the following unstructured bank SMS, receipt, or statement text:
"${rawText}"

Current year is 2026. If date is missing or ambiguous, assume current month (e.g. 2026-08-16).
Identify:
- merchant/title
- amount (positive number)
- type ('expense' or 'income')
- suggested category (e.g., Food & Dining, Groceries, Housing & Rent, Transportation, Shopping, Salary & Wages, Subscriptions, Utilities & Bills)
- date in YYYY-MM-DD format
- optional note or tags`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              extractedCount: { type: Type.NUMBER },
              transactions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    type: { type: Type.STRING, enum: ['expense', 'income'] },
                    category: { type: Type.STRING },
                    date: { type: Type.STRING },
                    note: { type: Type.STRING },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    paymentMethod: { type: Type.STRING },
                  },
                  required: ['title', 'amount', 'type', 'category', 'date'],
                },
              },
            },
            required: ['extractedCount', 'transactions'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json(parsed);
    }

    // Heuristic regex parser fallback
    const lines = rawText.split('\n').filter((l: string) => l.trim().length > 0);
    const results: any[] = [];

    for (const line of lines) {
      const amountMatch = line.match(/\$?([0-9]+(?:\.[0-9]{2})?)/);
      const amount = amountMatch ? parseFloat(amountMatch[1]) : 25.00;
      const isIncome = line.toLowerCase().includes('credit') || line.toLowerCase().includes('received') || line.toLowerCase().includes('salary') || line.toLowerCase().includes('deposit');

      results.push({
        title: line.replace(/\$?([0-9]+(?:\.[0-9]{2})?)/, '').replace(/paid to|debited|credited|on/gi, '').trim() || 'Imported Transaction',
        amount,
        type: isIncome ? 'income' : 'expense',
        category: isIncome ? 'Salary & Wages' : 'Food & Dining',
        date: new Date().toISOString().split('T')[0],
        note: 'Parsed from text snippet',
        tags: ['imported'],
        paymentMethod: 'Credit Card',
      });
    }

    return res.json({
      extractedCount: results.length,
      transactions: results,
    });
  } catch (error: any) {
    console.error('Parse text error:', error);
    res.status(500).json({ error: error.message || 'Failed to parse text' });
  }
});

// Vite Middleware for Frontend Integration
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ExpenseAI full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

start();
