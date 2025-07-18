import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import db from '../db/db'
import { monthly_fee } from '../db/schema/monthly_fee'
import { and, desc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import {
  Monthly_Fee_Insert_Update,
  Monthly_Fee_Read,
  Monthly_Fee_Read_Paid_Unpaid,
  Monthly_Fee_Record
} from '../../types/interfaces/monthly_fee'
import { students } from '../db/schema/student'
import { classes } from '../db/schema/class'
import { Transaction } from '@type/interfaces/db'
import { DB_DATE_FORMAT } from '@main/utils/constant/date'
import { addMonths, set } from 'date-fns'
import { format } from 'date-fns'
import PaymentService from './PaymentService'
type BulkCreate = {
  student_id: number
  class_id: number
  from: string
  count: number
  fee: number
  haveAmount: number
}
class MonthlyFeeService {
  db: BetterSQLite3Database<Record<string, never>> & {
    $client: Database.Database
  }

  constructor() {
    this.db = db
  }

  create(data: Monthly_Fee_Insert_Update, tx: Transaction = this.db): number {
    const result = tx.insert(monthly_fee).values(data).returning({ id: monthly_fee.id }).get()
    return result.id
  }

  createBulk({ student_id, class_id, from, count, fee, haveAmount }: BulkCreate, tx): number {
    if (count <= 0) {
      return 0
    }
    let used = 0
    let remain = haveAmount
    const start = set(from, { date: 1 })
    for (let i = 0; i < count; i++) {
      let paid = 0
      const amount = fee
      if (remain > amount) {
        paid = amount
        remain = remain - amount
      } else if (remain > 0) {
        paid = remain
        remain = 0
      } else {
        paid = 0
      }
      used += paid
      const input: Monthly_Fee_Insert_Update = {
        student_id,
        class_id,
        amount: fee,
        paid: paid,
        date: format(addMonths(start, i), DB_DATE_FORMAT)
      }
      this.create(input, tx)
    }

    return used
  }

  createBulkWithPayment(
    { student_id, class_id, from, count, fee, haveAmount }: BulkCreate,
    tx
  ): number {
    const input = {
      student_id: student_id,
      class_id: class_id,
      from: from,
      count,
      fee: fee,
      haveAmount
    }
    const usedAmount = this.createBulk(input, tx)
    PaymentService.adjustUsed(student_id, usedAmount, 'monthly', tx)

    return usedAmount
  }
  async delete(
    tx: BetterSQLite3Database<Record<string, never>> | null = null,
    id: number | number[]
  ): Promise<number> {
    try {
      const dbInstance = tx || this.db
      const result = dbInstance
        .delete(monthly_fee)
        .where(inArray(monthly_fee.id, Array.isArray(id) ? id : [id]))
        .run()

      return result.changes
    } catch (error) {
      if (error instanceof Error) {
        throw new Error('Error while deleting monthly fees: ' + error.message)
      } else {
        throw new Error('Unknown error while deleting monthly fees')
      }
    }
  }

  async list(studentId: number): Promise<Monthly_Fee_Record[]> {
    try {
      const result = this.db
        .select({
          id: monthly_fee.id,
          date: monthly_fee.date,
          amount: monthly_fee.amount,
          paid: monthly_fee.paid,
          class_name: classes.name,
          student_name: students.student_name
        })
        .from(monthly_fee)
        .innerJoin(classes, eq(monthly_fee.class_id, classes.id))
        .innerJoin(students, eq(monthly_fee.student_id, students.id))
        .where(eq(monthly_fee.student_id, studentId))
        .orderBy(desc(monthly_fee.date))
        .all()

      return result
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error('Error while listing monthly fees: ' + error.message)
      } else {
        throw new Error('Unknown error while listing monthly fees')
      }
    }
  }

  async listByDateRange(
    studentId: number,
    from: string,
    to: string
  ): Promise<Partial<Monthly_Fee_Record>[]> {
    try {
      const conditions = [
        eq(monthly_fee.student_id, studentId),
        gte(monthly_fee.date, from),
        lte(monthly_fee.date, to)
      ]

      const result = this.db
        .select({
          id: monthly_fee.id,
          date: monthly_fee.date,
          amount: monthly_fee.amount,
          class_name: classes.name,
          student_name: students.student_name
        })
        .from(monthly_fee)
        .where(and(...conditions))
        .orderBy(monthly_fee.date)
        .all()

      return result
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error('Error while listing monthly fees: ' + error.message)
      } else {
        throw new Error('Unknown error while listing monthly fees')
      }
    }
  }

  get(id: number): Monthly_Fee_Read | null {
    const charge = this.db
      .select({
        class_id: monthly_fee.class_id,
        student_id: monthly_fee.student_id,
        date: monthly_fee.date,
        amount: monthly_fee.amount,
        paid: monthly_fee.paid
      })
      .from(monthly_fee)
      .where(eq(monthly_fee.id, id))
      .get()

    return charge || null
  }

  unpaid_list(studentId: number): Monthly_Fee_Read_Paid_Unpaid[] {
    const condition = [
      eq(monthly_fee.student_id, studentId),
      lt(monthly_fee.paid, monthly_fee.amount)
    ]
    const list = this.db
      .select({
        id: monthly_fee.id,
        amount: monthly_fee.amount,
        paid: monthly_fee.paid
      })
      .from(monthly_fee)
      .where(and(...condition))
      .orderBy(desc(monthly_fee.paid), monthly_fee.date)
      .all()
    return list
  }

  //paid list
  paid_list(studentId: number): Monthly_Fee_Read_Paid_Unpaid[] {
    const condition = [eq(monthly_fee.student_id, studentId), gt(monthly_fee.paid, 0)]
    const list = this.db
      .select({
        id: monthly_fee.id,
        amount: monthly_fee.amount,
        paid: monthly_fee.paid
      })
      .from(monthly_fee)
      .where(and(...condition))
      .orderBy(monthly_fee.paid, desc(monthly_fee.date))
      .all()
    return list
  }
  paid(
    id: number,
    amount: number,
    tx: BetterSQLite3Database<Record<string, never>> = this.db
  ): boolean {
    const pay = tx
      .update(monthly_fee)
      .set({ paid: sql`${monthly_fee.paid} + ${amount}` })
      .where(eq(monthly_fee.id, id))
      .run()
    return pay.changes > 0
  }

  // unpaid reverse the paid amount

  unpaid(
    id: number,
    amount: number,
    tx: BetterSQLite3Database<Record<string, never>> = this.db
  ): boolean {
    const pay = tx
      .update(monthly_fee)
      .set({ paid: sql`${monthly_fee.paid} - ${amount}` })
      .where(eq(monthly_fee.id, id))
      .run()
    return pay.changes > 0
  }

  handlePaidUp(studentId: number, amount: number, tx: Transaction): number {
    const list = this.unpaid_list(studentId)
    let used = 0
    let remain = amount

    for (let i = 0; i < list.length && remain > 0; i++) {
      const charge = list[i]
      const toPay = charge.amount - charge.paid
      if (toPay > remain) {
        this.paid(charge.id, remain, tx)
        used += remain
        remain = 0
      } else {
        this.paid(charge.id, toPay, tx)
        used += toPay
        remain -= toPay
      }
    }

    return used
  }

  // handle paid down

  handlePaidDown(studentId: number, amount: number, tx: Transaction): number {
    const list = this.paid_list(studentId)

    let collect = 0
    let remain = Math.abs(amount) // will be negative

    for (let i = 0; i < list.length && remain > 0; i++) {
      const charge = list[i]
      const toCollect = charge.paid

      if (toCollect > remain) {
        this.unpaid(charge.id, remain, tx)
        collect += remain
        remain = 0
      } else {
        this.unpaid(charge.id, toCollect, tx)
        collect += toCollect
        remain -= toCollect
      }
    }

    return collect
  }
  // adjust the paid amount

  adjustPaid(studentId: number, amount: number, tx: Transaction | null): number {
    let used = 0
    if (amount == 0) {
      return 0
    }
    if (tx == null) {
      const paid = this.db.transaction((tx: Transaction) => {
        if (amount < 0) {
          // reverse the paid amount
          const havePaid = this.handlePaidDown(studentId, amount, tx)
          return -havePaid
        } else {
          // add the paid amount
          const havePaid = this.handlePaidUp(studentId, amount, tx)
          return havePaid
        }
      })

      used = paid
      return used
    }

    if (amount < 0) {
      // reverse the paid amount
      const havePaid = this.handlePaidDown(studentId, amount, tx)

      used = -havePaid
    } else {
      // add the paid amount
      const havePaid = this.handlePaidUp(studentId, amount, tx)
      used = havePaid
    }

    return used
  }
}

export default new MonthlyFeeService()
