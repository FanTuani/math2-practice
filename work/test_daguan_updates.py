"""Exercise inbound sync with a synthetic two-paper catalog and mock MCP tools."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'outputs'))
import daguan_server as server


class InboundUpdates(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        home = Path(directory.name)
        data = {
            'snapshot': [{'year': 2040, 'groups': [['选择题', 1]]},
                         {'year': 2039, 'groups': [['选择题', 1]], 'sectioned': True}],
            'question-content': {key: {'stem': '分别比较点 $(5,6)$、$(-3,9)$ 关于 $m$ 的量。'}
                                 for key in ('2040-1', '2039-1')}
        }
        (home / server.PAGE_NAME).write_text(''.join(
            f'<script id="{name}" type="application/json">{json.dumps(value)}</script>'
            for name, value in data.items()), encoding='utf-8')
        self.bridge = server.Bridge('http://127.0.0.1', home, home)
        self.bridge.store.data.update(connectionId='fixture', canWrite=True, canWriteFavorite=True)
        self.bridge.tools = {}
        self.event = {'id': 7, 'question_id': 88, 'source': None}
        self.question = {'id': 88, 'source': '2040年数学二第1题',
                         'stem': '取 $m$ 和两处坐标 $(-3,9)$ 与 $(5,6)$，以下命题正确的是？'}
        self.scoped = [self.event]
        self.search = {'items': [self.question], 'total': 1}
        self.bridge.tool = Mock(side_effect=self.tool)

    def tool(self, name, args):
        if name == 'learning_practice_events_list':
            return {'items': self.scoped if args.get('filter_list_id') == 'exam-math-2' else [self.event]}
        if name == 'question_get':
            return self.question if args['question_id'] == self.question['id'] else {'id': args['question_id']}
        if name == 'question_search':
            return self.search
        if name == server.READ_STATE:
            return {'mastery': 'needs_practice', 'is_favorite': True}
        self.fail(name)

    def test_unlinked_event_recovers_after_startup_and_caches(self):
        item, = self.bridge.updates()['items']
        self.assertEqual((item['key'], item['id'], item['status'], item['favorite']), ('2040-1', 88, 'P', True))
        self.assertEqual(self.bridge.store.data['links'], {'2040-1': 88})
        self.bridge.tool.reset_mock()
        self.assertEqual(self.bridge.updates(fresh=True)['items'], [item])
        self.bridge.tool.assert_not_called()

    def test_search_ambiguity_and_section_numbering_need_confirmation(self):
        self.search['total'] = 2
        self.assertEqual(self.bridge.updates()['items'], [])
        self.bridge.clear_timeline()
        self.search['total'] = 1
        self.question['source'] = '2039数二（1）'
        self.assertEqual(self.bridge.updates()['items'], [])

    def test_only_recent_math_ii_events_are_examined_with_a_budget(self):
        self.scoped = [{'id': qid, 'question_id': qid} for qid in range(21, 13, -1)]
        self.bridge.store.data['links'] = {'2040-1': 17}
        for _ in range(4):
            self.bridge.timeline_checked = 0
            self.bridge.updates()
        calls = [p.args[1]['question_id'] for p in self.bridge.tool.call_args_list if p.args[0] == 'question_get']
        self.assertEqual(calls, [21, 20, 19, 18])
        self.assertNotIn(self.event['question_id'], calls)

    def test_foreign_source_and_different_formula_are_not_linked(self):
        for field, value in [('source', '模拟2040年数学二第1题'), ('stem', '改变坐标 $(56)$、$(-3,9)$ 和 $m$')]:
            with self.subTest(field=field):
                self.bridge.clear_timeline()
                original = self.question[field]
                self.question[field] = value
                self.assertEqual(self.bridge.updates()['items'], [])
                self.question[field] = original


if __name__ == '__main__':
    unittest.main()
