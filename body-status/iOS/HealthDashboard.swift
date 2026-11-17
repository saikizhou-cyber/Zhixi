import Foundation
import HealthKit
import UserNotifications
import Combine

@MainActor
final class HealthDashboard: ObservableObject {
    @Published private(set) var heartRate: [HealthReading] = []
    @Published private(set) var hrv: [HealthReading] = []
    @Published private(set) var restingHeartRate: [HealthReading] = []
    @Published private(set) var sleepSegments: [SleepSegment] = []
    @Published private(set) var workouts: [DateInterval] = []
    @Published private(set) var isLoading = false
    @Published private(set) var lastLoadedAt: Date?
    @Published private(set) var webRecords: [[String: Any]] = []
    @Published private(set) var historyStart: Date?
    @Published private(set) var message: String?
    @Published private(set) var backgroundMessage: String?
    @Published private(set) var accessRequested: Bool
    @Published private(set) var remindersEnabled: Bool
    let isAvailable = HKHealthStore.isHealthDataAvailable()

    private let store = HKHealthStore()
    private let preferences = UserDefaults.standard
    private let bridge = WatchBridge()
    private var observers: [HKObserverQuery] = []
    private var refreshTask: Task<Void, Never>?
    private var refreshWaiters: [CheckedContinuation<Void, Never>] = []
    private var backgroundEnabled = false
    private let notificationID = "body-status.break"
    private let recordLimit = 250_000

    private var quantityMetrics: [(identifier: HKQuantityTypeIdentifier, type: String, label: String, unit: HKUnit, unitName: String, multiplier: Double)] {
        let perMinute = HKUnit.count().unitDivided(by: .minute())
        return [
            (.heartRate, "heartRate", "心率", perMinute, "bpm", 1),
            (.heartRateVariabilitySDNN, "hrv", "心率变异性", .secondUnit(with: .milli), "ms", 1),
            (.restingHeartRate, "restingHeartRate", "静息心率", perMinute, "bpm", 1),
            (.stepCount, "steps", "步数", .count(), "count", 1),
            (.activeEnergyBurned, "activeEnergy", "活动能量", .kilocalorie(), "kcal", 1),
            (.respiratoryRate, "respiratoryRate", "呼吸频率", perMinute, "breaths/min", 1),
            (.oxygenSaturation, "oxygenSaturation", "血氧饱和度", .percent(), "%", 100)
        ]
    }

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>(quantityMetrics.map { HKQuantityType.quantityType(forIdentifier: $0.identifier)! })
        types.insert(HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)!)
        types.insert(HKObjectType.workoutType())
        return types
    }

    init() {
        accessRequested = UserDefaults.standard.bool(forKey: "healthAccessRequested")
        remindersEnabled = UserDefaults.standard.bool(forKey: "breakRemindersEnabled")
        bridge.onRefreshRequested = { [weak self] in await self?.refresh() }
    }

    func prepareForLaunch() {
        if accessRequested && isAvailable { registerObservers() }
    }

    func start() async {
        guard isAvailable, accessRequested else { return }
        registerObservers()
        await enableBackgroundDelivery()
        await refresh()
    }

    func connect() async {
        guard isAvailable else {
            message = "这台设备无法使用 Apple 健康数据。请在支持 HealthKit 的 iPhone 上打开。"
            return
        }
        do {
            // 完成授权面板不代表获得了读取权限；HealthKit 不暴露读取授权结果。
            try await store.requestAuthorization(toShare: [], read: readTypes)
            accessRequested = true
            preferences.set(true, forKey: "healthAccessRequested")
            registerObservers()
            await enableBackgroundDelivery()
            await refresh()
        } catch {
            message = "无法完成健康授权：\(error.localizedDescription)"
        }
    }

    func refresh() async {
        guard isAvailable, accessRequested else { return }
        await withCheckedContinuation { continuation in
            // 查询开始后的通知要等下一轮读取，才能完成对应的观察回调。
            refreshWaiters.append(continuation)
            guard refreshTask == nil else { return }
            refreshTask = Task {
                while !self.refreshWaiters.isEmpty {
                    let waiters = self.refreshWaiters
                    self.refreshWaiters.removeAll()
                    await self.loadReadings()
                    waiters.forEach { $0.resume() }
                }
                self.refreshTask = nil
            }
        }
    }

    func webSnapshot() -> [String: Any] {
        [
            "version": 1,
            "available": isAvailable,
            "accessRequested": accessRequested,
            "isLoading": isLoading,
            "lastLoadedAt": lastLoadedAt.map { ($0.timeIntervalSince1970 * 1000) as Any } ?? NSNull(),
            "historyStart": historyStart.map { ($0.timeIntervalSince1970 * 1000) as Any } ?? NSNull(),
            "message": message.map { $0 as Any } ?? NSNull(),
            "backgroundMessage": backgroundMessage.map { $0 as Any } ?? NSNull(),
            "records": webRecords
        ]
    }

    private func loadReadings() async {
        isLoading = true
        defer { isLoading = false }
        let now = Date()
        let calendar = Calendar.current
        // shortcut: 最近 90 天全量读取；历史量继续增长时改为有删除追踪的锚定查询。
        let from = calendar.date(byAdding: .day, value: -90, to: calendar.startOfDay(for: now))!
        historyStart = from
        // 重新读取前清空快照，撤回权限、删样本或查询失败都不会沿用上次健康值。
        webRecords = []
        lastLoadedAt = nil
        heartRate = []; hrv = []; restingHeartRate = []; sleepSegments = []; workouts = []
        var records: [[String: Any]] = []
        var errors: [String] = []
        for metric in quantityMetrics {
            do {
                let samples = try await query(HKQuantityType.quantityType(forIdentifier: metric.identifier)!, from: from, to: now, capacity: recordLimit - records.count)
                var readings: [HealthReading] = []
                for case let sample as HKQuantitySample in samples where validSample(sample, to: now) {
                    let value = sample.quantity.doubleValue(for: metric.unit) * metric.multiplier
                    let permitsZero = metric.type == "steps" || metric.type == "activeEnergy"
                    guard value.isFinite, value >= 0, permitsZero || value > 0,
                          metric.type != "oxygenSaturation" || value <= 100 else { continue }
                    records.append(webRecord(sample, type: metric.type, value: value, unit: metric.unitName))
                    if ["heartRate", "hrv", "restingHeartRate"].contains(metric.type) {
                        readings.append(HealthReading(id: sample.uuid, value: value, date: sample.endDate,
                            sourceID: sample.sourceRevision.source.bundleIdentifier,
                            sourceName: sample.sourceRevision.source.name))
                    }
                }
                switch metric.type {
                case "heartRate": heartRate = readings
                case "hrv": hrv = readings
                case "restingHeartRate": restingHeartRate = readings
                default: break
                }
            } catch { errors.append("\(metric.label)：\(error.localizedDescription)") }
        }
        do {
            let samples = try await query(HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)!, from: from, to: now, capacity: recordLimit - records.count)
            let stages = [
                HKCategoryValueSleepAnalysis.inBed.rawValue: "inBed",
                HKCategoryValueSleepAnalysis.awake.rawValue: "awake",
                HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue: "asleep",
                HKCategoryValueSleepAnalysis.asleepCore.rawValue: "core",
                HKCategoryValueSleepAnalysis.asleepDeep.rawValue: "deep",
                HKCategoryValueSleepAnalysis.asleepREM.rawValue: "rem"
            ]
            let valid = samples.compactMap { $0 as? HKCategorySample }.filter {
                validSample($0, to: now) && $0.startDate < $0.endDate && stages[$0.value] != nil
            }
            let latestSource = valid.last?.sourceRevision.source.bundleIdentifier
            for sample in valid {
                guard let stage = stages[sample.value] else { continue }
                records.append(webRecord(sample, type: "sleep", value: stage, unit: ""))
                if stage != "inBed", stage != "awake", sample.sourceRevision.source.bundleIdentifier == latestSource {
                    sleepSegments.append(SleepSegment(start: sample.startDate, end: sample.endDate))
                }
            }
        } catch { errors.append("睡眠：\(error.localizedDescription)") }
        var workoutReadSucceeded = false
        do {
            let samples = try await query(HKObjectType.workoutType(), from: from, to: now, capacity: recordLimit - records.count)
            for case let sample as HKWorkout in samples where validSample(sample, to: now) && sample.startDate < sample.endDate {
                records.append(webRecord(sample, type: "workout", value: workoutName(sample.workoutActivityType), unit: ""))
                workouts.append(DateInterval(start: sample.startDate, end: sample.endDate))
            }
            workoutReadSucceeded = true
        } catch { errors.append("体能训练：\(error.localizedDescription)") }
        assert(records.count <= recordLimit, "HealthKit snapshot exceeded its record budget")
        webRecords = records
        message = errors.isEmpty ? nil : "部分数据暂时无法读取：" + errors.joined(separator: "；")
        lastLoadedAt = Date()
        bridge.publish(WatchSummary(
            generatedAt: now,
            assessment: BodyAnalysis.assessHRV(hrv, now: now),
            heart: heartRate.last
        ))
        // 运动查询出错时不推断当前静息，也不发出休息建议。
        if workoutReadSucceeded { await considerReminder(now: now) }
    }

    private func validSample(_ sample: HKSample, to: Date) -> Bool {
        sample.startDate.timeIntervalSince1970.isFinite && sample.endDate.timeIntervalSince1970.isFinite
            && sample.startDate.timeIntervalSince1970 >= 0
            && sample.startDate <= sample.endDate && sample.endDate <= to
            && (sample.metadata?[HKMetadataKeyWasUserEntered] as? NSNumber)?.boolValue != true
    }

    private func webRecord(_ sample: HKSample, type: String, value: Any, unit: String) -> [String: Any] {
        let source = sample.sourceRevision.source
        return ["type": type, "value": value, "unit": unit,
                "start": sample.startDate.timeIntervalSince1970 * 1000,
                "end": sample.endDate.timeIntervalSince1970 * 1000,
                "source": "\(source.name) (\(source.bundleIdentifier))"]
    }

    private func workoutName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .walking: return "步行"
        case .running: return "跑步"
        case .cycling: return "骑行"
        case .swimming: return "游泳"
        case .hiking: return "徒步"
        case .yoga: return "瑜伽"
        case .traditionalStrengthTraining: return "传统力量训练"
        case .functionalStrengthTraining: return "功能性力量训练"
        case .highIntensityIntervalTraining: return "高强度间歇训练"
        case .rowing: return "划船"
        case .elliptical: return "椭圆机"
        case .stairClimbing: return "爬楼梯"
        case .mindAndBody: return "身心训练"
        default: return "体能训练（\(type.rawValue)）"
        }
    }

    private enum ReadError: LocalizedError {
        case recordLimit
        var errorDescription: String? { "本轮最多读取 250,000 条健康记录；该指标超出剩余容量，整项未加载。" }
    }

    private func query(_ type: HKSampleType, from: Date, to: Date, capacity: Int) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: [])
            let limit = capacity
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: limit + 1,
                                      sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)]) { _, samples, error in
                if let error { continuation.resume(throwing: error) }
                else if (samples?.count ?? 0) > limit { continuation.resume(throwing: ReadError.recordLimit) }
                else { continuation.resume(returning: samples ?? []) }
            }
            store.execute(query)
        }
    }

    private func registerObservers() {
        guard observers.isEmpty else { return }
        for type in readTypes.compactMap({ $0 as? HKSampleType }) {
            let observer = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, error in
                Task { @MainActor [weak self] in
                    defer { completion() }
                    guard let self else { return }
                    if let error {
                        self.backgroundMessage = "后台数据通知暂不可用：\(error.localizedDescription)"
                        return
                    }
                    await self.refresh()
                }
            }
            observers.append(observer)
            store.execute(observer)
        }
    }

    private func enableBackgroundDelivery() async {
        guard !backgroundEnabled else { return }
        var errors: [String] = []
        for type in readTypes {
            do { try await store.enableBackgroundDelivery(for: type, frequency: .immediate) }
            catch { errors.append(error.localizedDescription) }
        }
        backgroundEnabled = errors.isEmpty
        backgroundMessage = errors.isEmpty ? nil : "后台更新尚不可用，可打开 App 手动刷新。" + errors.joined(separator: "；")
    }

    func setRemindersEnabled(_ enabled: Bool) async {
        if !enabled {
            remindersEnabled = false
            preferences.set(false, forKey: "breakRemindersEnabled")
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [notificationID])
            return
        }
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            remindersEnabled = allowed
            preferences.set(allowed, forKey: "breakRemindersEnabled")
            if !allowed { message = "通知尚未开启。可以在 iPhone 设置中找到「知息」并允许通知。" }
        } catch { message = "无法开启通知：\(error.localizedDescription)" }
    }

    private func considerReminder(now: Date) async {
        guard remindersEnabled else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        let hour = Calendar.current.component(.hour, from: now)
        guard (8..<22).contains(hour), BodyAnalysis.shouldSuggestBreak(readings: hrv, workouts: workouts, now: now),
              let current = BodyAnalysis.assessHRV(hrv, now: now).current else { return }
        let lastDate = preferences.object(forKey: "lastBreakReminderDate") as? Date
        guard lastDate == nil || now.timeIntervalSince(lastDate!) >= 4 * 60 * 60,
              preferences.string(forKey: "lastBreakReminderSample") != current.id.uuidString else { return }
        let content = UNMutableNotificationContent()
        content.title = "给自己一个短暂的停顿"
        content.body = "近期身体信号有变化。如果方便，可以休息片刻；打开知息查看数据与说明。"
        content.sound = .default
        do {
            try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: notificationID, content: content, trigger: nil))
            preferences.set(now, forKey: "lastBreakReminderDate")
            preferences.set(current.id.uuidString, forKey: "lastBreakReminderSample")
        } catch { message = "休息提醒未能送达：\(error.localizedDescription)" }
    }
}
