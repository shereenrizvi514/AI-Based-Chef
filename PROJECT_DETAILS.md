# ChefAI: Personal Culinary Assistant - Project Documentation

## Project Overview
**ChefAI** is a cutting-edge, AI-powered personal culinary assistant designed to revolutionize the home cooking experience. By combining advanced AI models with intuitive kitchen management tools, ChefAI helps users reduce food waste, discover new flavors, and simplify their daily meal routines.

---

## Key Features

### 1. Smart Multimodal Chat (Chef AI)
- **Text, Voice, & Image Interaction:** Users can interact with Chef AI by typing, speaking, or uploading images.
- **Image Analysis:** Identify dishes or ingredients from photos to get instant recipes or nutritional info.
- **Voice Mode:** Continuous, hands-free conversational mode with automatic language detection (English/Urdu).
- **Context Awareness:** The AI knows what's in your fridge and your saved recipes.

### 2. Fridge Inventory Management
- **Real-time Tracking:** Easily add and remove ingredients from your digital fridge.
- **Smart Suggestions:** Get recipe ideas based specifically on what you already have, reducing food waste.

### 3. Taste DNA Analysis
- **Personalized Flavor Profile:** Analyzes user preferences to create a "Taste DNA" radar chart (Sweet, Salt, Spice, Umami, Acid).
- **Tailored Recommendations:** Recipes are prioritized based on the user's unique flavor profile.

### 4. Recipe Explorer & Search
- **Unlimited Recipe Search:** Search for any dish globally using AI-powered search.
- **Voice Search:** Hands-free recipe searching.
- **Voice-Guided Cooking:** Step-by-step audio instructions with voice commands ("Next", "Repeat", "Back").

### 5. Weekly Meal Planner (Pro Feature)
- **Organized Planning:** Schedule meals for the entire week.
- **Nutrition Tracking:** View nutritional summaries for planned meals.

### 6. Smart Grocery Lists (Pro Feature)
- **Auto-Generation:** Automatically add missing ingredients from recipes to your grocery list.
- **Syncing:** Keep your shopping organized and synced with your meal plans.

---

## Subscription Tiers (Freemium Model)

### Free Tier
- AI Recipe Generation
- Fridge Management
- Taste DNA Analysis
- **4 Image Uploads per 24 hours**

### Pro Tier (Monthly/Yearly)
- **Unlimited Image Uploads**
- Weekly Meal Planner
- Smart Grocery Lists
- Priority AI Support
- Exclusive Pro Recipes

---

## Technical Stack

- **Frontend:** React 18, TypeScript, Vite
- **Styling:** Tailwind CSS (Utility-first CSS)
- **Animations:** Framer Motion (motion/react)
- **Icons:** Lucide React
- **Data Visualization:** Recharts (Radar Charts)
- **Backend/Database:** Firebase (Authentication & Firestore)
- **AI Integration:** Google Gemini API (@google/genai)
- **Voice APIs:** Web Speech API (SpeechRecognition & SpeechSynthesis)

---

## Security & Privacy
- **Firestore Security Rules:** Robust rules ensure that user data, fridge inventory, and chat history are private and secure.
- **Authentication:** Secure Google Login via Firebase Auth.
- **Data Validation:** Strict schema enforcement for all database writes.

---

## Future Roadmap
- Integration with smart kitchen appliances.
- Community recipe sharing and social features.
- Advanced dietary restriction filters (Keto, Vegan, etc.).
- Offline mode for grocery lists.
