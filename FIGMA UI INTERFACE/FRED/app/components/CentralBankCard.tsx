import { useState } from "react";
import { ChevronDown, TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface CentralBankData {
  id: string;
  name: string;
  country: string;
  flag: string;
  interestRate: number;
  inflationRate: number;
  interestRateChange: number;
  inflationRateChange: number;
  lastUpdated: string;
  details: {
    nextMeeting: string;
    previousRate: number;
    targetInflation: number;
    gdpGrowth: number;
    unemployment: number;
  };
}

interface CentralBankCardProps {
  bank: CentralBankData;
}

export function CentralBankCard({ bank }: CentralBankCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getRateChangeIcon = (change: number) => {
    if (change > 0) return <TrendingUp className="w-4 h-4" />;
    if (change < 0) return <TrendingDown className="w-4 h-4" />;
    return <Minus className="w-4 h-4" />;
  };

  const getRateChangeColor = (change: number) => {
    if (change > 0) return "text-green-600";
    if (change < 0) return "text-red-600";
    return "text-gray-500";
  };

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{bank.flag}</span>
            <div>
              <h3 className="font-semibold text-gray-900">{bank.name}</h3>
              <p className="text-sm text-gray-500">{bank.country}</p>
            </div>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-gray-400 transition-transform ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>

        {/* Main Rates */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-xs text-gray-600 mb-1">Interest Rate</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-blue-700">
                {bank.interestRate}%
              </span>
              <span
                className={`flex items-center gap-1 text-sm ${getRateChangeColor(
                  bank.interestRateChange
                )}`}
              >
                {getRateChangeIcon(bank.interestRateChange)}
                {Math.abs(bank.interestRateChange)}%
              </span>
            </div>
          </div>

          <div className="bg-purple-50 rounded-lg p-4">
            <p className="text-xs text-gray-600 mb-1">Inflation Rate</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-purple-700">
                {bank.inflationRate}%
              </span>
              <span
                className={`flex items-center gap-1 text-sm ${getRateChangeColor(
                  bank.inflationRateChange
                )}`}
              >
                {getRateChangeIcon(bank.inflationRateChange)}
                {Math.abs(bank.inflationRateChange)}%
              </span>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-400">
          Updated: {bank.lastUpdated}
        </p>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-200 bg-gray-50 p-6 animate-in slide-in-from-top-2">
          <h4 className="font-semibold text-gray-900 mb-4">Additional Details</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Next Meeting</p>
              <p className="text-sm font-medium text-gray-900">
                {bank.details.nextMeeting}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Previous Rate</p>
              <p className="text-sm font-medium text-gray-900">
                {bank.details.previousRate}%
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Target Inflation</p>
              <p className="text-sm font-medium text-gray-900">
                {bank.details.targetInflation}%
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">GDP Growth</p>
              <p className="text-sm font-medium text-gray-900">
                {bank.details.gdpGrowth}%
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Unemployment</p>
              <p className="text-sm font-medium text-gray-900">
                {bank.details.unemployment}%
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
