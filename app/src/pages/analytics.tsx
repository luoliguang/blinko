import React, { useEffect } from 'react'
import { observer } from "mobx-react-lite"
import { RootStore } from "@/store/root"
import { AnalyticsStore } from "@/store/analyticsStore"
import { useTranslation } from "react-i18next"
import { HeatMap } from "@/components/BlinkoAnalytics/HeatMap"
import { StatsCards } from "@/components/BlinkoAnalytics/StatsCards"
import { TagDistributionChart } from "@/components/BlinkoAnalytics/TagDistributionChart"
import dayjs from "@/lib/dayjs"
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button } from "@heroui/react"
import { Icon } from '@/components/Common/Iconify/icons'
import { ScrollArea } from '@/components/Common/ScrollArea'

const Analytics = observer(() => {
  const analyticsStore = RootStore.Get(AnalyticsStore)
  const { t } = useTranslation()
  const [selectedMonth, setSelectedMonth] = React.useState(dayjs().format("YYYY-MM"))
  analyticsStore.use()

  useEffect(() => {
    analyticsStore.setSelectedMonth(selectedMonth)
  }, [selectedMonth])

  const currentMonth = dayjs().format("YYYY-MM")
  const last12Months = Array.from({ length: 12 }, (_, i) => {
    return dayjs().subtract(i, "month").format("YYYY-MM")
  })

  const data = analyticsStore.dailyNoteCount.value?.map(item => [
    item.date,
    item.count
  ] as [string, number]) ?? []

  const stats = analyticsStore.monthlyStats.value

  const hasWeekday = typeof stats?.mostActiveWeekday === 'number' && stats.mostActiveWeekday >= 0
  const weekdayLabel = hasWeekday ? dayjs().day(stats!.mostActiveWeekday).format('dddd') : ''
  const mom = stats?.monthOverMonth ?? 0
  const momUp = mom >= 0

  return (
    <ScrollArea onBottom={() => { }} fixMobileTopBar className="px-6 space-y-3 md:p-6 md:space-y-6  mx-auto max-w-7xl" >
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('analytics')}</h1>
        <Dropdown>
          <DropdownTrigger>
            <Button
              variant="flat"
              className="w-[160px] justify-between bg-default-100 hover:bg-default-200"
              size="md"
              endContent={<Icon icon="mdi:chevron-down" className="h-4 w-4" />}
              startContent={<Icon icon="mdi:calendar" className="h-4 w-4" />}
            >
              {selectedMonth}
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label="Select month"
            selectionMode="single"
            selectedKeys={[selectedMonth]}
            className="max-h-[400px]"
            onSelectionChange={(key) => {
              const value = Array.from(key)[0] as string
              setSelectedMonth(value)
            }}
          >
            {last12Months.map((month) => (
              <DropdownItem
                key={month}
                className="data-[selected=true]:bg-primary-500/20"
              >
                {month}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>
      </div>

      <StatsCards stats={stats ?? {}} />

      {stats && (
        <div className="flex flex-wrap items-center gap-2">
          {stats.longestStreak > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-default-100 px-3 py-1 text-xs font-medium">
              <Icon icon="ri:fire-fill" className="h-3.5 w-3.5 text-orange-400" />
              <span className="text-foreground/60">{t('longest-streak')}</span>
              <span className="font-bold">{stats.longestStreak}</span>
            </div>
          )}
          {hasWeekday && (
            <div className="flex items-center gap-1.5 rounded-full bg-default-100 px-3 py-1 text-xs font-medium">
              <Icon icon="ri:calendar-event-line" className="h-3.5 w-3.5 text-primary" />
              <span className="text-foreground/60">{t('most-active-weekday')}</span>
              <span className="font-bold">{weekdayLabel}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-full bg-default-100 px-3 py-1 text-xs font-medium">
            <Icon icon={momUp ? 'ri:arrow-up-line' : 'ri:arrow-down-line'} className={`h-3.5 w-3.5 ${momUp ? 'text-green-500' : 'text-red-500'}`} />
            <span className="text-foreground/60">{t('month-over-month')}</span>
            <span className={`font-bold ${momUp ? 'text-green-500' : 'text-red-500'}`}>{momUp ? '+' : ''}{mom}%</span>
          </div>
        </div>
      )}

      <HeatMap
        data={data}
        title={t('heatMapTitle')}
        description={t('heatMapDescription')}
      />

      {
        stats?.tagStats && stats.tagStats.length > 0 && (
          <TagDistributionChart tagStats={stats.tagStats} />
        )
      }
    </ScrollArea >
  )
})

export default Analytics