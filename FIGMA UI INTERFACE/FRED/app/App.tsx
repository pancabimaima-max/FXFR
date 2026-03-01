import { CentralBankCard, CentralBankData } from "./components/CentralBankCard";
import { Building2 } from "lucide-react";

export default function App() {
  const centralBanks: CentralBankData[] = [
    {
      id: "fed",
      name: "Federal Reserve",
      country: "United States",
      flag: "🇺🇸",
      interestRate: 5.50,
      inflationRate: 3.2,
      interestRateChange: 0.25,
      inflationRateChange: -0.3,
      lastUpdated: "March 1, 2026",
      details: {
        nextMeeting: "March 15, 2026",
        previousRate: 5.25,
        targetInflation: 2.0,
        gdpGrowth: 2.4,
        unemployment: 3.8,
      },
    },
    {
      id: "ecb",
      name: "European Central Bank",
      country: "European Union",
      flag: "🇪🇺",
      interestRate: 4.00,
      inflationRate: 2.8,
      interestRateChange: 0,
      inflationRateChange: -0.5,
      lastUpdated: "February 28, 2026",
      details: {
        nextMeeting: "March 12, 2026",
        previousRate: 4.00,
        targetInflation: 2.0,
        gdpGrowth: 1.2,
        unemployment: 6.5,
      },
    },
    {
      id: "boe",
      name: "Bank of England",
      country: "United Kingdom",
      flag: "🇬🇧",
      interestRate: 5.25,
      inflationRate: 3.5,
      interestRateChange: 0,
      inflationRateChange: -0.4,
      lastUpdated: "February 27, 2026",
      details: {
        nextMeeting: "March 20, 2026",
        previousRate: 5.25,
        targetInflation: 2.0,
        gdpGrowth: 1.8,
        unemployment: 4.2,
      },
    },
    {
      id: "boj",
      name: "Bank of Japan",
      country: "Japan",
      flag: "🇯🇵",
      interestRate: 0.25,
      inflationRate: 2.1,
      interestRateChange: 0.10,
      inflationRateChange: 0.2,
      lastUpdated: "February 26, 2026",
      details: {
        nextMeeting: "March 18, 2026",
        previousRate: 0.15,
        targetInflation: 2.0,
        gdpGrowth: 0.9,
        unemployment: 2.6,
      },
    },
    {
      id: "boc",
      name: "Bank of Canada",
      country: "Canada",
      flag: "🇨🇦",
      interestRate: 4.75,
      inflationRate: 2.9,
      interestRateChange: -0.25,
      inflationRateChange: -0.3,
      lastUpdated: "February 25, 2026",
      details: {
        nextMeeting: "March 8, 2026",
        previousRate: 5.00,
        targetInflation: 2.0,
        gdpGrowth: 2.1,
        unemployment: 5.3,
      },
    },
    {
      id: "rba",
      name: "Reserve Bank of Australia",
      country: "Australia",
      flag: "🇦🇺",
      interestRate: 4.35,
      inflationRate: 3.4,
      interestRateChange: 0,
      inflationRateChange: -0.2,
      lastUpdated: "February 24, 2026",
      details: {
        nextMeeting: "March 5, 2026",
        previousRate: 4.35,
        targetInflation: 2.5,
        gdpGrowth: 2.7,
        unemployment: 4.1,
      },
    },
    {
      id: "snb",
      name: "Swiss National Bank",
      country: "Switzerland",
      flag: "🇨🇭",
      interestRate: 1.75,
      inflationRate: 1.8,
      interestRateChange: 0,
      inflationRateChange: -0.1,
      lastUpdated: "February 23, 2026",
      details: {
        nextMeeting: "March 21, 2026",
        previousRate: 1.75,
        targetInflation: 2.0,
        gdpGrowth: 1.5,
        unemployment: 2.1,
      },
    },
    {
      id: "pboc",
      name: "People's Bank of China",
      country: "China",
      flag: "🇨🇳",
      interestRate: 3.45,
      inflationRate: 1.2,
      interestRateChange: -0.10,
      inflationRateChange: 0.1,
      lastUpdated: "February 22, 2026",
      details: {
        nextMeeting: "March 10, 2026",
        previousRate: 3.55,
        targetInflation: 3.0,
        gdpGrowth: 5.2,
        unemployment: 5.0,
      },
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">
              Central Bank Monitor
            </h1>
          </div>
          <p className="text-gray-600">
            Real-time interest rates and inflation data from major central banks
            worldwide
          </p>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {centralBanks.map((bank) => (
            <CentralBankCard key={bank.id} bank={bank} />
          ))}
        </div>
      </div>
    </div>
  );
}
