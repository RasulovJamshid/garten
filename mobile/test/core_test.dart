import 'package:flutter_test/flutter_test.dart';
import 'package:alishax_mobile/core/session.dart';
import 'package:alishax_mobile/core/api.dart';
import 'package:alishax_mobile/ui/attendance.dart';
import 'package:alishax_mobile/ui/resources.dart';

void main() {
  test('money preserves precision beyond JavaScript safe integers', () {
    expect(toTiyin('900719925474099.93'), '90071992547409993');
    expect(money('90071992547409993'), '900 719 925 474 099.93 UZS');
    expect(toTiyin('1 234,50'), '123450');
    expect(() => toTiyin('0'), throwsFormatException);
    expect(() => toTiyin('-10'), throwsFormatException);
    expect(() => toTiyin('1.999'), throwsFormatException);
  });
  test('Tashkent date crosses UTC midnight without device timezone', () {
    expect(today(DateTime.parse('2026-09-17T20:00:00Z')), '2026-09-18');
    expect(dateText('2021-04-17T00:00:00.000Z'), '17.04.2021');
  });
  test('unmarked attendance is distinct from absent and checked out', () {
    expect(attendanceStatus({'attendance': null}), 'pending');
    expect(
      attendanceStatus({
        'attendance': {'status': 'absent'},
      }),
      'absent',
    );
    expect(
      attendanceStatus({
        'attendance': {'checkInAt': 'x'},
      }),
      'inside',
    );
    expect(
      attendanceStatus({
        'attendance': {'checkInAt': 'x', 'checkOutAt': 'x'},
      }),
      'left',
    );
  });
  test('payment reversal relation changes visual status', () {
    expect(
      isReversed({
        'sign': 1,
        'otherPayment': [
          {'id': 'reversal'},
        ],
      }),
      isTrue,
    );
    expect(isReversed({'sign': -1}), isTrue);
    expect(isReversed({'sign': 1, 'otherPayment': []}), isFalse);
  });
  test('collection normalization accepts both API shapes', () {
    expect(
      records({
        'data': [
          {'id': 'a'},
        ],
      }).single['id'],
      'a',
    );
    expect(
      records([
        {'id': 'b'},
      ]).single['id'],
      'b',
    );
  });
}
