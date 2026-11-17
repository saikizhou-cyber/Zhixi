import XCTest
@testable import BodyStatusCore

final class BodyStatusCoreTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private var now: Date {
        date(2026, 11, 17, hour: 10)
    }

    private func date(_ year: Int, _ month: Int, _ day: Int, hour: Int = 0, minute: Int = 0, calendar: Calendar? = nil) -> Date {
        (calendar ?? self.calendar).date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    private func reading(_ value: Double, at date: Date, source: String = "watch") -> HealthReading {
        HealthReading(value: value, date: date, sourceID: source, sourceName: source)
    }

    private func history(_ values: [Double] = [40, 50, 60, 70, 80, 90, 100], source: String = "watch", relativeTo anchor: Date? = nil) -> [HealthReading] {
        let anchor = anchor ?? now
        return values.enumerated().map { index, value in
            reading(value, at: calendar.date(byAdding: .day, value: -index - 1, to: anchor)!, source: source)
        }
    }

    func testNoDataAndInvalidValuesDoNotBecomeAState() {
        let readings = [
            reading(.nan, at: now), reading(.infinity, at: now),
            reading(0, at: now), reading(-2, at: now),
            reading(40, at: now.addingTimeInterval(1)),
            reading(40, at: Date(timeIntervalSinceReferenceDate: .nan))
        ]
        let result = BodyAnalysis.assessHRV(readings, now: now, calendar: calendar)
        XCTAssertEqual(result.level, .noData)
        XCTAssertNil(result.current)
        XCTAssertNil(result.baseline)
    }

    func testRequiresSevenDistinctDaysAndExcludesToday() {
        let samples = history(Array(repeating: 50, count: 6)) +
            (0..<100).map { reading(50, at: now.addingTimeInterval(Double(-$0 * 10))) }
        let result = BodyAnalysis.assessHRV(samples, now: now, calendar: calendar)
        XCTAssertEqual(result.level, .buildingBaseline)
        XCTAssertEqual(result.baselineDays, 6)
        XCTAssertNil(result.lowerBound)
    }

    func testQuantilesAndInclusiveCommonRange() {
        let below = BodyAnalysis.assessHRV(history() + [reading(54, at: now)], now: now, calendar: calendar)
        XCTAssertEqual(below.level, .belowUsual)
        XCTAssertEqual(below.baseline, 70)
        XCTAssertEqual(below.lowerBound, 55)
        XCTAssertEqual(below.upperBound, 85)
        for value in [55.0, 70, 85] {
            XCTAssertEqual(BodyAnalysis.assessHRV(history() + [reading(value, at: now)], now: now, calendar: calendar).level, .usual)
        }
        XCTAssertEqual(BodyAnalysis.assessHRV(history() + [reading(86, at: now)], now: now, calendar: calendar).level, .aboveUsual)
    }

    func testDailyWeightingPreventsFrequentSamplingFromDominatingBaseline() {
        let denseDay = calendar.date(byAdding: .day, value: -1, to: now)!
        let denseSamples = (0..<100).map { reading(40, at: denseDay.addingTimeInterval(Double($0))) }
        let result = BodyAnalysis.assessHRV(history() + denseSamples + [reading(70, at: now)], now: now, calendar: calendar)
        XCTAssertEqual(result.baselineDays, 7)
        XCTAssertEqual(result.baseline, 70)
        XCTAssertEqual(result.level, .usual)
    }

    func testSourceChangeCannotBorrowAnotherSourcesBaseline() {
        let result = BodyAnalysis.assessHRV(history() + [reading(40, at: now, source: "new-watch")], now: now, calendar: calendar)
        XCTAssertEqual(result.level, .buildingBaseline)
        XCTAssertEqual(result.baselineDays, 0)
    }

    func testFutureSampleCannotChangeSelectedSource() {
        let result = BodyAnalysis.assessHRV(history() + [reading(70, at: now), reading(20, at: now.addingTimeInterval(60), source: "future-source")], now: now, calendar: calendar)
        XCTAssertEqual(result.level, .usual)
        XCTAssertEqual(result.current?.sourceID, "watch")
    }

    func testBaselineIsRestrictedToThePrevious28CalendarDays() {
        let oldDay = calendar.date(byAdding: .day, value: -29, to: now)!
        let firstIncludedDay = calendar.date(byAdding: .day, value: -28, to: calendar.startOfDay(for: now))!
        let result = BodyAnalysis.assessHRV(history(Array(repeating: 60, count: 6)) + [reading(300, at: oldDay), reading(60, at: firstIncludedDay), reading(60, at: now)], now: now, calendar: calendar)
        XCTAssertEqual(result.baselineDays, 7)
        XCTAssertEqual(result.baseline, 60)
    }

    func testStalenessBoundaryAndStalenessBeforeBaseline() {
        let fresh = reading(70, at: now.addingTimeInterval(-BodyAnalysis.freshnessInterval))
        XCTAssertEqual(BodyAnalysis.assessHRV(history() + [fresh], now: now, calendar: calendar).level, .usual)
        let stale = reading(70, at: fresh.date.addingTimeInterval(-1))
        XCTAssertEqual(BodyAnalysis.assessHRV(history() + [stale], now: now, calendar: calendar).level, .stale)
        XCTAssertEqual(BodyAnalysis.assessHRV([stale], now: now, calendar: calendar).level, .stale)
    }

    func testDailyMediansUseOnlyLatestSourceAndStableIDs() {
        let first = reading(40, at: date(2026, 11, 16, hour: 9))
        let second = reading(80, at: date(2026, 11, 16, hour: 10))
        let readings = [first, second, reading(200, at: date(2026, 11, 16, hour: 8), source: "other")]
        let daily = BodyAnalysis.dailyMedians(readings, calendar: calendar)
        XCTAssertEqual(daily.count, 1)
        XCTAssertEqual(daily.first?.value, 60)
        XCTAssertEqual(daily.first?.date, date(2026, 11, 16))
        XCTAssertEqual(daily.first?.sourceID, "watch")
        XCTAssertEqual(daily.first?.id, second.id)
        XCTAssertEqual(daily, BodyAnalysis.dailyMedians(Array(readings.reversed()), calendar: calendar))
    }

    func testSleepOverlapsAreMergedAndClippedToWindow() {
        let start = date(2026, 11, 16, hour: 22)
        let end = date(2026, 11, 17, hour: 6)
        let segments = [
            SleepSegment(start: start.addingTimeInterval(-3600), end: start.addingTimeInterval(7200)),
            SleepSegment(start: start.addingTimeInterval(3600), end: start.addingTimeInterval(10800)),
            SleepSegment(start: start.addingTimeInterval(10800), end: start.addingTimeInterval(14400)),
            SleepSegment(start: end.addingTimeInterval(-3600), end: end.addingTimeInterval(7200)),
            SleepSegment(start: end, end: start),
            SleepSegment(start: start, end: start)
        ]
        XCTAssertEqual(BodyAnalysis.sleepDuration(segments, from: start, to: end), 5 * 3600)
        XCTAssertEqual(BodyAnalysis.sleepDuration(segments, from: end, to: start), 0)
        XCTAssertEqual(BodyAnalysis.sleepDuration([], from: start, to: end), 0)
    }

    func testSleepWindowBeforeAndAfterNoon() {
        let morning = BodyAnalysis.sleepWindow(now: now, calendar: calendar)
        XCTAssertEqual(morning.start, date(2026, 11, 16, hour: 12))
        XCTAssertEqual(morning.end, now)
        let afternoon = BodyAnalysis.sleepWindow(now: date(2026, 11, 17, hour: 15), calendar: calendar)
        XCTAssertEqual(afternoon.start, morning.start)
        XCTAssertEqual(afternoon.end, date(2026, 11, 17, hour: 12))
    }

    func testSleepWindowHonorsDaylightSavingTransitions() {
        var localCalendar = calendar
        localCalendar.timeZone = TimeZone(identifier: "America/New_York")!
        let spring = BodyAnalysis.sleepWindow(now: date(2026, 3, 8, hour: 15, calendar: localCalendar), calendar: localCalendar)
        let fall = BodyAnalysis.sleepWindow(now: date(2026, 11, 1, hour: 15, calendar: localCalendar), calendar: localCalendar)
        XCTAssertEqual(spring.duration, 23 * 3600)
        XCTAssertEqual(fall.duration, 25 * 3600)
        XCTAssertEqual(localCalendar.component(.hour, from: spring.start), 12)
        XCTAssertEqual(localCalendar.component(.hour, from: fall.start), 12)
    }

    func testTwoFreshLowSamplesCanSuggestABreak() {
        let readings = history() + [reading(35, at: now.addingTimeInterval(-600)), reading(30, at: now)]
        XCTAssertTrue(BodyAnalysis.shouldSuggestBreak(readings: readings, workouts: [], now: now, calendar: calendar))
    }

    func testOtherSourceAtSameTimeCannotOverrideEarlierLowReading() {
        let earlier = now.addingTimeInterval(-600)
        let readings = history() + history(source: "zzz") + [reading(35, at: earlier), reading(200, at: earlier, source: "zzz"), reading(30, at: now)]
        XCTAssertTrue(BodyAnalysis.shouldSuggestBreak(readings: readings, workouts: [], now: now, calendar: calendar))
    }

    func testDuplicateTimesShortIntervalsAndStaleSamplesCannotSuggestABreak() {
        let latest = reading(30, at: now)
        for previous in [reading(30, at: now), reading(35, at: now.addingTimeInterval(-299)), reading(35, at: now.addingTimeInterval(-1801))] {
            XCTAssertFalse(BodyAnalysis.shouldSuggestBreak(readings: history() + [previous, latest], workouts: [], now: now, calendar: calendar))
        }
    }

    func testNormalLatestValueAndDifferentSourcesCannotSuggestABreak() {
        let low = reading(30, at: now.addingTimeInterval(-600))
        XCTAssertFalse(BodyAnalysis.shouldSuggestBreak(readings: history() + [low, reading(70, at: now)], workouts: [], now: now, calendar: calendar))
        XCTAssertFalse(BodyAnalysis.shouldSuggestBreak(readings: history() + history(source: "other") + [reading(30, at: low.date, source: "other"), reading(30, at: now)], workouts: [], now: now, calendar: calendar))
    }

    func testRecentWorkoutSuppressesSuggestionButOldOrFutureWorkoutDoesNot() {
        let readings = history() + [reading(35, at: now.addingTimeInterval(-600)), reading(30, at: now)]
        let recent = DateInterval(start: now.addingTimeInterval(-3600), end: now.addingTimeInterval(-900))
        XCTAssertFalse(BodyAnalysis.shouldSuggestBreak(readings: readings, workouts: [recent], now: now, calendar: calendar))
        let old = DateInterval(start: now.addingTimeInterval(-7200), end: now.addingTimeInterval(-3600))
        let future = DateInterval(start: now.addingTimeInterval(600), duration: 1200)
        XCTAssertTrue(BodyAnalysis.shouldSuggestBreak(readings: readings, workouts: [old, future], now: now, calendar: calendar))
    }
}
