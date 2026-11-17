import Foundation

public struct HealthReading: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let value: Double
    public let date: Date
    public let sourceID: String
    public let sourceName: String

    public init(id: UUID = UUID(), value: Double, date: Date, sourceID: String, sourceName: String) {
        self.id = id
        self.value = value
        self.date = date
        self.sourceID = sourceID
        self.sourceName = sourceName
    }
}

public struct SleepSegment: Equatable, Sendable {
    public let start: Date
    public let end: Date

    public init(start: Date, end: Date) {
        self.start = start
        self.end = end
    }
}

public enum SignalLevel: String, Sendable {
    case noData, buildingBaseline, stale, belowUsual, usual, aboveUsual
}

public struct HRVAssessment: Sendable {
    public let level: SignalLevel
    public let current: HealthReading?
    public let baseline: Double?
    public let lowerBound: Double?
    public let upperBound: Double?
    public let baselineDays: Int

    public init(level: SignalLevel, current: HealthReading?, baseline: Double?, lowerBound: Double?, upperBound: Double?, baselineDays: Int) {
        self.level = level
        self.current = current
        self.baseline = baseline
        self.lowerBound = lowerBound
        self.upperBound = upperBound
        self.baselineDays = baselineDays
    }
}

public enum BodyAnalysis {
    // 30 分钟是产品的新鲜度规则，不是临床有效期。
    public static let freshnessInterval: TimeInterval = 30 * 60

    public static func assessHRV(_ readings: [HealthReading], now: Date, calendar: Calendar = .current) -> HRVAssessment {
        let valid = readings.filter { isValid($0) && $0.date <= now }
        guard let current = latest(valid) else {
            return HRVAssessment(level: .noData, current: nil, baseline: nil, lowerBound: nil, upperBound: nil, baselineDays: 0)
        }
        let today = calendar.startOfDay(for: now)
        guard let start = calendar.date(byAdding: .day, value: -28, to: today) else {
            return HRVAssessment(level: .buildingBaseline, current: current, baseline: nil, lowerBound: nil, upperBound: nil, baselineDays: 0)
        }
        let history = valid.filter {
            $0.sourceID == current.sourceID && $0.date >= start && $0.date < today
        }
        let daily = dailyMedians(history, calendar: calendar).map(\.value).sorted()
        let enoughHistory = daily.count >= 7
        let baseline = enoughHistory ? quantile(daily, fraction: 0.5) : nil
        let lower = enoughHistory ? quantile(daily, fraction: 0.25) : nil
        let upper = enoughHistory ? quantile(daily, fraction: 0.75) : nil
        let level: SignalLevel
        if now.timeIntervalSince(current.date) > freshnessInterval {
            level = .stale
        } else if let lower, let upper {
            level = current.value < lower ? .belowUsual : (current.value > upper ? .aboveUsual : .usual)
        } else {
            level = .buildingBaseline
        }
        return HRVAssessment(level: level, current: current, baseline: baseline, lowerBound: lower, upperBound: upper, baselineDays: daily.count)
    }

    public static func dailyMedians(_ readings: [HealthReading], calendar: Calendar = .current) -> [HealthReading] {
        let valid = readings.filter(isValid)
        guard let source = latest(valid)?.sourceID else { return [] }
        let days = Dictionary(grouping: valid.filter { $0.sourceID == source }) {
            calendar.startOfDay(for: $0.date)
        }
        return days.keys.sorted().compactMap { day in
            guard let samples = days[day], let representative = latest(samples) else { return nil }
            let value = quantile(samples.map(\.value).sorted(), fraction: 0.5)
            return HealthReading(id: representative.id, value: value, date: day, sourceID: source, sourceName: representative.sourceName)
        }
    }

    public static func sleepDuration(_ segments: [SleepSegment], from: Date, to: Date) -> TimeInterval {
        guard from.timeIntervalSinceReferenceDate.isFinite,
              to.timeIntervalSinceReferenceDate.isFinite,
              to > from else { return 0 }
        let intervals = segments.compactMap { segment -> SleepSegment? in
            guard segment.start.timeIntervalSinceReferenceDate.isFinite,
                  segment.end.timeIntervalSinceReferenceDate.isFinite else { return nil }
            let start = max(segment.start, from)
            let end = min(segment.end, to)
            return start < end ? SleepSegment(start: start, end: end) : nil
        }.sorted { $0.start < $1.start }
        guard var merged = intervals.first else { return 0 }
        var total: TimeInterval = 0
        for interval in intervals.dropFirst() {
            if interval.start <= merged.end {
                merged = SleepSegment(start: merged.start, end: max(merged.end, interval.end))
            } else {
                total += merged.end.timeIntervalSince(merged.start)
                merged = interval
            }
        }
        return total + merged.end.timeIntervalSince(merged.start)
    }

    public static func sleepWindow(now: Date, calendar: Calendar = .current) -> DateInterval {
        guard let noon = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: now),
              let yesterdayNoon = calendar.date(byAdding: .day, value: -1, to: noon) else {
            return DateInterval(start: now, duration: 0)
        }
        return DateInterval(start: yesterdayNoon, end: min(noon, now))
    }

    public static func shouldSuggestBreak(readings: [HealthReading], workouts: [DateInterval], now: Date, calendar: Calendar = .current) -> Bool {
        let cutoff = now.addingTimeInterval(-freshnessInterval)
        guard !workouts.contains(where: { $0.duration > 0 && $0.start <= now && $0.end >= cutoff }) else { return false }
        let assessment = assessHRV(readings, now: now, calendar: calendar)
        guard assessment.level == .belowUsual, let current = assessment.current else { return false }
        let sameSource = readings.filter { $0.sourceID == current.sourceID }
        return readings.contains { candidate in
            guard isValid(candidate),
                  candidate.sourceID == current.sourceID,
                  candidate.date >= cutoff,
                  current.date.timeIntervalSince(candidate.date) >= 5 * 60 else { return false }
            return assessHRV(sameSource, now: candidate.date, calendar: calendar).level == .belowUsual
        }
    }

    private static func isValid(_ reading: HealthReading) -> Bool {
        reading.value.isFinite && reading.value > 0 && reading.date.timeIntervalSinceReferenceDate.isFinite
    }

    private static func latest(_ readings: [HealthReading]) -> HealthReading? {
        readings.max {
            if $0.date != $1.date { return $0.date < $1.date }
            if $0.sourceID != $1.sourceID { return $0.sourceID < $1.sourceID }
            return $0.id.uuidString < $1.id.uuidString
        }
    }

    private static func quantile(_ sorted: [Double], fraction: Double) -> Double {
        let index = Double(sorted.count - 1) * fraction
        let lower = Int(index.rounded(.down))
        let upper = Int(index.rounded(.up))
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - Double(lower))
    }
}
