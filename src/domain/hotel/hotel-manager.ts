import type { DatabaseManager } from '@/core/db-manager.js'

type RoomStatus = 'available' | 'occupied' | 'maintenance'
type ServiceRequestStatus = 'pending' | 'in-progress' | 'completed'
type ServiceRequestPriority = 'low' | 'medium' | 'high'

export interface RoomRecord {
  id: number
  number: number
  type: string
  price: number
  status: RoomStatus
  notes?: string
  updatedAt: string
}

export interface BookingRecord {
  id: number
  roomId: number
  roomNumber: number
  roomType: string
  guestName: string
  checkIn: string
  checkOut: string
  status: string
  notes?: string
  createdAt: string
}

export interface ServiceRequestRecord {
  id: number
  roomId: number
  roomNumber: number
  guestName?: string
  requestType: string
  description?: string
  priority: ServiceRequestPriority
  status: ServiceRequestStatus
  createdAt: string
}

export interface StaffScheduleRecord {
  id: number
  staffName: string
  role: string
  shift: string
  date: string
  note?: string
  createdAt: string
}

export interface AvailabilityInput {
  checkIn?: string
  checkOut?: string
}

export class HotelManager {
  constructor(private db: DatabaseManager) {}

  async listRooms(): Promise<RoomRecord[]> {
    const rows = await this.db.query(
      `SELECT id, number, type, price, status, notes, updated_at FROM rooms ORDER BY number ASC`,
    )
    return rows.map(this.mapRoom)
  }

  async listBookings(opts?: { startDate?: string; endDate?: string; status?: string }): Promise<BookingRecord[]> {
    const clauses: string[] = ['1=1']
    const params: Record<string, unknown> = {}

    if (opts?.startDate) {
      clauses.push('b.check_in >= @startDate')
      params.startDate = opts.startDate
    }
    if (opts?.endDate) {
      clauses.push('b.check_out <= @endDate')
      params.endDate = opts.endDate
    }
    if (opts?.status) {
      clauses.push('b.status = @status')
      params.status = opts.status
    }

    const rows = await this.db.query(
      `SELECT b.*, r.number AS room_number, r.type AS room_type
       FROM bookings b
       JOIN rooms r ON r.id = b.room_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY b.check_in ASC`,
      params,
    )
    return rows.map(this.mapBooking)
  }

  async getServiceRequests(status?: ServiceRequestStatus): Promise<ServiceRequestRecord[]> {
    const clauses: string[] = ['1=1']
    const params: Record<string, unknown> = {}
    if (status) {
      clauses.push('sr.status = @status')
      params.status = status
    }

    const rows = await this.db.query(
      `SELECT sr.*, r.number AS room_number
       FROM service_requests sr
       JOIN rooms r ON r.id = sr.room_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY
         CASE sr.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
         sr.created_at DESC`,
      params,
    )
    return rows.map(this.mapServiceRequest)
  }

  async getStaffSchedule(date: string): Promise<StaffScheduleRecord[]> {
    const rows = await this.db.query(
      `SELECT * FROM staff_schedule WHERE date = @date ORDER BY shift ASC`,
      { date },
    )
    return rows.map(this.mapSchedule)
  }

  async findAvailableRooms(input: AvailabilityInput = {}): Promise<RoomRecord[]> {
    const today = new Date().toISOString().slice(0, 10)
    const checkIn = input.checkIn ?? today
    const checkOut = input.checkOut ?? checkIn
    if (checkOut < checkIn) {
      throw new Error('check-out must be the same or after check-in')
    }

    const occupied = await this.db.query(
      `SELECT DISTINCT room_id FROM bookings
       WHERE NOT (check_out <= @start OR check_in >= @end)
         AND status != 'cancelled'`,
      { start: checkIn, end: checkOut },
    )
    const blocked = new Set(occupied.map((row: Record<string, unknown>) => row.room_id as number))
    const rooms = await this.listRooms()
    return rooms.filter((room) => room.status === 'available' && !blocked.has(room.id))
  }

  async updateRoomStatus(roomNumber: number, status: RoomStatus): Promise<RoomRecord> {
    const result = this.db.execute(
      `UPDATE rooms SET status = @status, updated_at = CURRENT_TIMESTAMP WHERE number = @number`,
      { status, number: roomNumber },
    )
    if ((result as { changes: number }).changes === 0) {
      throw new Error(`Room ${roomNumber} not found`)
    }
    const updated = await this.getRoomByNumber(roomNumber)
    if (!updated) {
      throw new Error('Room updated but missing record')
    }
    return updated
  }

  async getDailySummary(date?: string): Promise<{
    date: string
    totalRooms: number
    availableRooms: number
    bookings: BookingRecord[]
    serviceRequests: ServiceRequestRecord[]
    staffSchedule: StaffScheduleRecord[]
  }> {
    const targetDate = date ?? new Date().toISOString().slice(0, 10)
    const [rooms, bookings, serviceRequests, staffSchedule] = await Promise.all([
      this.listRooms(),
      this.listBookings({ startDate: targetDate, endDate: targetDate }),
      this.getServiceRequests('pending'),
      this.getStaffSchedule(targetDate),
    ])
    return {
      date: targetDate,
      totalRooms: rooms.length,
      availableRooms: rooms.filter((room) => room.status === 'available').length,
      bookings,
      serviceRequests,
      staffSchedule,
    }
  }

  private async getRoomByNumber(number: number): Promise<RoomRecord | null> {
    const rows = await this.db.query(
      `SELECT id, number, type, price, status, notes, updated_at FROM rooms WHERE number = @number LIMIT 1`,
      { number },
    )
    if (rows.length === 0) return null
    return this.mapRoom(rows[0])
  }

  private mapRoom(row: Record<string, unknown>): RoomRecord {
    return {
      id: Number(row.id),
      number: Number(row.number),
      type: String(row.type),
      price: Number(row.price),
      status: (row.status as RoomStatus) ?? 'available',
      notes: typeof row.notes === 'string' ? row.notes : undefined,
      updatedAt: String(row.updated_at),
    }
  }

  private mapBooking(row: Record<string, unknown>): BookingRecord {
    return {
      id: Number(row.id),
      roomId: Number(row.room_id),
      roomNumber: Number(row.room_number),
      roomType: String(row.room_type),
      guestName: String(row.guest_name),
      checkIn: String(row.check_in),
      checkOut: String(row.check_out),
      status: String(row.status),
      notes: typeof row.notes === 'string' ? row.notes : undefined,
      createdAt: String(row.created_at),
    }
  }

  private mapServiceRequest(row: Record<string, unknown>): ServiceRequestRecord {
    return {
      id: Number(row.id),
      roomId: Number(row.room_id),
      roomNumber: Number(row.room_number),
      guestName: typeof row.guest_name === 'string' ? row.guest_name : undefined,
      requestType: String(row.request_type),
      description: typeof row.description === 'string' ? row.description : undefined,
      priority: (row.priority as ServiceRequestPriority) ?? 'medium',
      status: (row.status as ServiceRequestStatus) ?? 'pending',
      createdAt: String(row.created_at),
    }
  }

  private mapSchedule(row: Record<string, unknown>): StaffScheduleRecord {
    return {
      id: Number(row.id),
      staffName: String(row.staff_name),
      role: String(row.role),
      shift: String(row.shift),
      date: String(row.date),
      note: typeof row.note === 'string' ? row.note : undefined,
      createdAt: String(row.created_at),
    }
  }
}
