# Billing Rules Questionnaire

**For: the kindergarten's accountant and director**
**Purpose: these answers are needed before development of the billing module begins. They cannot be changed cheaply after the system holds real financial data.**

Please answer every question. Where a rule already exists on paper, attach the document. Where no rule exists, decide one now — "we handle it case by case" is not an answer the system can implement.

---

## Section 1 — Attendance and charging

The system has been designed so that **parents pay only for days the child attended**.

**1.1** Is that correct? If not, describe how you actually charge.
> ☐ Yes, pay per attended day  ☐ No — fixed monthly regardless of attendance  ☐ Other: ______

**1.2** If a child is **sick** and does not attend, is that day charged?
> ☐ Not charged  ☐ Charged in full  ☐ Charged at a reduced rate of ____%
> ☐ Not charged only with a doctor's note  ☐ Free after ____ consecutive days

**1.3** If a child is on **vacation** (family holiday), is that day charged?
> ☐ Not charged  ☐ Charged in full  ☐ Reduced "place-holding" fee of __________ som per day
> ☐ Free for up to ____ days per year, charged after that

**1.4** Do you have a **half-day** option? If so, what does a half day cost relative to a full day?
> ☐ No half day  ☐ Yes, ____% of a full day  ☐ Yes, fixed __________ som

**1.5** How is a **daily rate** calculated from the monthly fee?
> ☐ Monthly fee ÷ actual working days that month (varies: 20, 21, 22…)
> ☐ Monthly fee ÷ a fixed number of days: ____
> ☐ Monthly fee ÷ calendar days

**1.6** If a child attends **every single working day**, do they pay exactly the monthly fee, or can it exceed it?
> ☐ Exactly the monthly fee, never more  ☐ Can exceed

**1.7** If a child attends **zero days** in a month, what is charged?
> ☐ Nothing  ☐ A minimum fee of __________ som  ☐ The full monthly fee

---

## Section 2 — Discounts

The system applies **fixed-amount discounts first, then percentage discounts**. Example: a 1,500,000 fee with a 200,000 sibling discount and a 10% staff discount → (1,500,000 − 200,000) × 0.90 = **1,170,000**.

**2.1** Is that order correct?
> ☐ Yes  ☐ No — percentage first, then fixed

**2.2** List every discount you currently give, with its exact rule:

| Discount name | Fixed amount or % | Who qualifies | Any conditions |
|---|---|---|---|
| | | | |
| | | | |
| | | | |

**2.3** If a child qualifies for **two percentage discounts** (say 10% and 5%), what is the result?
> ☐ 15% total  ☐ 10% then 5% of the remainder (14.5%)  ☐ Only the larger one applies

**2.4** If a child qualifies for **two fixed discounts**, do they add together?
> ☐ Yes, they add  ☐ Only the larger one applies

**2.5** Is a discount reduced when the child attends fewer days?
> ☐ No — the full discount applies regardless of attendance
> ☐ Yes — the discount is prorated the same way the fee is

**2.6** Do discounts apply to **meals and transport**, or only to tuition?
> ☐ Tuition only  ☐ Everything

---

## Section 3 — Extra charges

**3.1** List every charge beyond tuition:

| Charge | Amount | Per day / per month / one-time | Charged when child is absent? |
|---|---|---|---|
| Meals | | | |
| Transport | | | |
| Extra classes | | | |
| Registration fee | | | |
| Other: | | | |

**3.2** Meals on an absent day — charged or not?
> ☐ Not charged  ☐ Charged unless cancelled before ____ o'clock the previous day  ☐ Always charged

**3.3** Is the **registration fee** refundable? Does it fall under discounts?
> Refundable: ☐ Yes ☐ No    Discountable: ☐ Yes ☐ No

---

## Section 4 — Invoicing and payment

Because parents pay per attended day, **an invoice for a month can only be produced after that month ends.** March's invoice is generated on 1 April.

**4.1** Is that acceptable, or do you currently collect payment in advance?
> ☐ Acceptable — bill after the month ends
> ☐ We collect in advance — we need an estimated charge on the 1st, corrected after the month closes
> ☐ Other: ______

**4.2** If you currently collect in advance and we switch to billing in arrears, do you want to take a **deposit** at enrollment (typically one month, held and applied to the child's final month)?
> ☐ Yes, deposit of __________  ☐ No

**4.3** By which day of the month must a charge be paid before it counts as overdue?
> Day ____ of the month

**4.4** What happens when a parent does not pay?
> ☐ Reminder after ____ days  ☐ Child suspended after ____ days  ☐ Other: ______

**4.5** Which payment methods do you accept?
> ☐ Cash  ☐ Bank transfer  ☐ Card  ☐ Online  ☐ Other: ______

**4.6** When a parent pays less than they owe, which debt is paid off first?
> ☐ The oldest unpaid charge first  ☐ The parent chooses  ☐ The newest first

**4.7** When a parent pays **more** than they owe, what happens to the extra?
> ☐ Held as credit toward next month  ☐ Refunded  ☐ Other: ______

---

## Section 5 — Enrollment and withdrawal

**5.1** A child enrolls on the 14th. What is charged for that month?
> ☐ Only the days actually attended  ☐ The full month  ☐ Half the month  ☐ Other: ______

**5.2** A child leaves on the 10th. What is charged?
> ☐ Only the days attended  ☐ The full month  ☐ Other: ______

**5.3** Is any notice period required before withdrawal, and does it affect the final invoice?
> ☐ No notice required  ☐ ____ days notice, otherwise charged __________

---

## Section 6 — Corrections and closing

**6.1** Once you have generated the month's charges, may attendance for that month still be corrected?
> ☐ Yes, and the charge should be recalculated automatically
> ☐ Yes, but the correction should appear as an adjustment on the next month's bill
> ☐ No, the month is locked once charges are issued

**6.2** By which day of the following month do you want the previous month "closed" (no further changes possible)?
> Day ____

**6.3** Who is authorized to cancel a payment or reverse a charge?
> ☐ Accountant  ☐ Director only  ☐ Owner only

---

## Section 7 — Rounding and presentation

**7.1** Should amounts be rounded?
> ☐ To the tiyin (no rounding)  ☐ To the nearest som  ☐ To the nearest 1,000 som

**7.2** What must appear on a receipt? (attach a sample of your current receipt if one exists)
> ______________________________________________

---

## Section 8 — Opening balances

Before go-live we must load each child's **current debt or credit** as an opening balance.

**8.1** As of which date should opening balances be taken?
> ______________________

**8.2** Do you have a reliable list of current debts per child?
> ☐ Yes, in Excel  ☐ Yes, on paper  ☐ Partially  ☐ No

**8.3** For any child whose balance cannot be confirmed, we will load **zero** and you will handle it manually. Accepted?
> ☐ Yes

> **Note:** the accountant must sign a printed list of all opening balances before import. An incorrect opening balance propagates into every future statement and is very difficult to unwind once payments have been applied against it.

---

**Completed by:** ____________________  **Role:** ____________  **Date:** __________

**Signature:** ____________________
