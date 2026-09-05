import { z } from "zod"
import { Prisma } from "@prisma/client"
import dayjs from "@shared/lib/dayjs"

import { router, authProcedure } from "../middleware"
import { prisma } from "../prisma"

export const analyticsRouter = router({
  dailyNoteCount: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/analytics/daily-note-count', summary: 'Query daily note count', protect: true, tags: ['Analytics'] } })
    .input(z.void())
    .output(z.array(z.object({
      date: z.string(),
      count: z.number()
    })))
    .mutation(async function ({ ctx }) {
      const dailyStats = await prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT 
          to_char("createdAt"::date, 'YYYY-MM-DD') as date,
          COUNT(*) as count
        FROM "notes"
        WHERE "accountId" = ${parseInt(ctx.id)}
          AND "createdAt" >= NOW() - INTERVAL '1 year'
        GROUP BY "createdAt"::date
        ORDER BY "createdAt"::date ASC
      `;

      return dailyStats.map(stat => ({
        date: stat.date,
        count: Number(stat.count)
      }));
    }),

  monthlyStats: authProcedure
    .meta({ openapi: { method: 'POST', path: '/v1/analytics/monthly-stats', summary: 'Query monthly statistics', protect: true, tags: ['Analytics'] } })
    .input(z.object({
      month: z.string()
    }))
    .output(z.object({
      noteCount: z.number(),
      totalWords: z.number(),
      maxDailyWords: z.number(),
      activeDays: z.number(),
      avgWordsPerNote: z.number(),
      currentStreak: z.number(),
      longestStreak: z.number(),
      mostActiveWeekday: z.number(), // 0-6 (0=Sunday), -1 when no data
      monthOverMonth: z.number(),    // % change in note count vs previous month
      tagStats: z.array(z.object({
        tagName: z.string(),
        count: z.number()
      })).optional()
    }))
    .mutation(async function ({ ctx, input }) {
      const startDate = dayjs(input.month).startOf('month').toDate()
      const endDate = dayjs(input.month).endOf('month').toDate()

      const noteCount = await prisma.notes.count({
        where: {
          accountId: parseInt(ctx.id),
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        }
      })

      const wordStats = await prisma.$queryRaw<Array<{ date: string; words: bigint }>>`
        SELECT 
          to_char("createdAt"::date, 'YYYY-MM-DD') as date,
          SUM(LENGTH(content)) as words
        FROM "notes"
        WHERE "accountId" = ${parseInt(ctx.id)}
          AND "createdAt" >= ${startDate}
          AND "createdAt" <= ${endDate}
        GROUP BY "createdAt"::date
        ORDER BY words DESC
      `

      const totalWords = wordStats.reduce((sum, stat) => sum + Number(stat.words), 0)
      const maxDailyWords = wordStats.length > 0 ? Number(wordStats[0]!.words) : 0
      const activeDays = wordStats.length
      const avgWordsPerNote = noteCount > 0 ? Math.round(totalWords / noteCount) : 0

      // Month-over-month change in note count (vs previous month).
      const prevStart = dayjs(input.month).subtract(1, 'month').startOf('month').toDate()
      const prevEnd = dayjs(input.month).subtract(1, 'month').endOf('month').toDate()
      const prevNoteCount = await prisma.notes.count({
        where: {
          accountId: parseInt(ctx.id),
          createdAt: { gte: prevStart, lte: prevEnd }
        }
      })
      const monthOverMonth = prevNoteCount > 0
        ? Math.round(((noteCount - prevNoteCount) / prevNoteCount) * 100)
        : (noteCount > 0 ? 100 : 0)

      // Streaks + most active weekday computed over the past year of activity.
      // NOTE: dates are bucketed by the DB's timezone (::date on createdAt), same
      // as dailyNoteCount/heatmap — keep these consistent so the numbers line up.
      const yearActivity = await prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT to_char("createdAt"::date, 'YYYY-MM-DD') as date, COUNT(*) as count
        FROM "notes"
        WHERE "accountId" = ${parseInt(ctx.id)}
          AND "createdAt" >= NOW() - INTERVAL '1 year'
        GROUP BY "createdAt"::date
        ORDER BY date ASC
      `
      const activeDateSet = new Set(yearActivity.map(a => a.date))

      // Longest run of consecutive active days.
      let longestStreak = 0
      let run = 0
      let prevDay: ReturnType<typeof dayjs> | null = null
      for (const a of yearActivity) {
        const cur = dayjs(a.date)
        run = (prevDay && cur.diff(prevDay, 'day') === 1) ? run + 1 : 1
        if (run > longestStreak) longestStreak = run
        prevDay = cur
      }

      // Current streak: count back from today (or yesterday) while consecutive.
      let currentStreak = 0
      let cursor = dayjs().startOf('day')
      if (!activeDateSet.has(cursor.format('YYYY-MM-DD'))) {
        cursor = cursor.subtract(1, 'day')
      }
      while (activeDateSet.has(cursor.format('YYYY-MM-DD'))) {
        currentStreak += 1
        cursor = cursor.subtract(1, 'day')
      }

      // Most active weekday (0=Sunday ... 6=Saturday) by note count.
      const weekdayCounts = new Array(7).fill(0)
      for (const a of yearActivity) {
        weekdayCounts[dayjs(a.date).day()] += Number(a.count)
      }
      let mostActiveWeekday = -1
      let maxWeekdayCount = 0
      weekdayCounts.forEach((c, i) => {
        if (c > maxWeekdayCount) { maxWeekdayCount = c; mostActiveWeekday = i }
      })

      const tagStats = await prisma.tag.findMany({
        where: {
          accountId: parseInt(ctx.id),
          tagsToNote: {
            some: {
              note: {
                accountId: parseInt(ctx.id)
              }
            }
          }
        },
        select: {
          name: true,
          _count: {
            select: {
              tagsToNote: true
            }
          }
        },
        orderBy: {
          tagsToNote: {
            _count: 'desc'
          }
        }
      })

      const validTags = tagStats.filter(tag => tag._count.tagsToNote > 0)
      const totalTagCount = validTags.reduce((sum, tag) => sum + tag._count.tagsToNote, 0)
      // Group tiny slices (<3% of total) into "Others" to reduce label clutter,
      // and cap the number of distinct slices. Always keep at least the top 3.
      const MIN_SLICE_RATIO = 0.03
      const MAX_SLICES = 8
      const bigTags = validTags.filter((tag, i) =>
        i < 3 || (totalTagCount > 0 && tag._count.tagsToNote / totalTagCount >= MIN_SLICE_RATIO)
      ).slice(0, MAX_SLICES)

      const bigTagCount = bigTags.reduce((sum, tag) => sum + tag._count.tagsToNote, 0)
      const otherTagsCount = totalTagCount - bigTagCount

      const finalTagStats = bigTags.map(tag => ({
        tagName: tag.name,
        count: tag._count.tagsToNote
      }))

      if (otherTagsCount > 0) {
        finalTagStats.push({
          tagName: 'Others',
          count: otherTagsCount
        })
      }

      return {
        noteCount,
        totalWords,
        maxDailyWords,
        activeDays,
        avgWordsPerNote,
        currentStreak,
        longestStreak,
        mostActiveWeekday,
        monthOverMonth,
        tagStats: finalTagStats
      }
    })
})