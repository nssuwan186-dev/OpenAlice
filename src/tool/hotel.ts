import { tool } from 'ai'
import { z } from 'zod'
import { HotelManager } from '@/domain/hotel/hotel-manager.js'

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const dateSchema = z.string().regex(datePattern, 'Expected YYYY-MM-DD format')
const roomStatuses = z.enum(['available', 'occupied', 'maintenance'] as const)
const serviceStatuses = z.enum(['pending', 'in-progress', 'completed'] as const)

export function createHotelTools(hotel: HotelManager) {
  return {
    listHotelRooms: tool({
      description: 'List every defined room together with its status, type, price, and last update.',
      inputSchema: z.object({}),
      execute: async () => ({ rooms: await hotel.listRooms() }),
    }),

    listHotelBookings: tool({
      description: 'List bookings filtered by status and date range (inclusive).',
      inputSchema: z.object({
        startDate: dateSchema.optional(),
        endDate: dateSchema.optional(),
        status: z.string().optional(),
      }),
      execute: async ({ startDate, endDate, status }) => ({
        bookings: await hotel.listBookings({ startDate, endDate, status }),
        filters: { startDate, endDate, status },
      }),
    }),

    checkAvailableRooms: tool({
      description: 'Check which rooms are available between the requested check-in and check-out dates.',
      inputSchema: z.object({
        checkIn: dateSchema.optional(),
        checkOut: dateSchema.optional(),
      }),
      execute: async ({ checkIn, checkOut }) => {
        const rooms = await hotel.findAvailableRooms({ checkIn, checkOut })
        return { checkIn, checkOut, available: rooms }
      },
    }),

    listServiceRequests: tool({
      description: 'Get pending/service requests optionally filtered by status or priority.',
      inputSchema: z.object({
        status: serviceStatuses.optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async ({ status, limit }) => {
        const requests = await hotel.getServiceRequests(status)
        return {
          requests: limit ? requests.slice(0, limit) : requests,
          count: requests.length,
          filters: { status, limit },
        }
      },
    }),

    updateRoomStatus: tool({
      description: 'Update the availability state of a specific room number (available, occupied, maintenance).',
      inputSchema: z.object({
        roomNumber: z.number().int().positive(),
        status: roomStatuses,
      }),
      execute: async ({ roomNumber, status }) => ({
        updated: await hotel.updateRoomStatus(roomNumber, status),
        message: `Room ${roomNumber} is now ${status}`,
      }),
    }),

    getStaffSchedule: tool({
      description: 'Get the staff schedule for a specific day.',
      inputSchema: z.object({ date: dateSchema }),
      execute: async ({ date }) => ({
        date,
        schedule: await hotel.getStaffSchedule(date),
      }),
    }),

    hotelDailySummary: tool({
      description: 'Summarize occupancy, bookings, service tasks, and staff coverage for the selected day.',
      inputSchema: z.object({ date: dateSchema.optional() }),
      execute: async ({ date }) => ({
        summary: await hotel.getDailySummary(date),
      }),
    }),
  }
}
