"""Offline regression tests for the documented MCP write contract."""
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'outputs'))
import daguan_server as server


class MarkTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.bridge = server.Bridge('http://127.0.0.1', Path(folder.name))
        self.key, self.qid = '2040-1', 7
        self.bridge.store.data.update(connectionId='test', canWrite=True, canWriteFavorite=True,
                                      links={self.key: self.qid})
        self.bridge.tools = {server.WRITE_STATE: {
            'required': ['question_id', 'operation_id'],
            'properties': {k: {} for k in ('question_id', 'operation_id', 'is_favorite',
                                           'expected_is_favorite', 'mastery', 'expected_mastery')}
        }}
        self.remote = {'mastery': 'not_started', 'is_favorite': False}
        self.writes = []
        self.fail_before_commit = False
        network = patch.object(self.bridge, 'tool', side_effect=self.call_tool)
        network.start()
        self.addCleanup(network.stop)

    def call_tool(self, name, args):
        self.assertEqual(args['question_id'], self.qid)
        if name == server.READ_STATE:
            return self.remote.copy()
        self.assertEqual(name, server.WRITE_STATE)
        field = 'mastery' if 'mastery' in args else 'is_favorite'
        self.assertEqual(set(args), {'question_id', 'operation_id', field, 'expected_' + field})
        self.assertIsNotNone(re.fullmatch(r'[A-Za-z0-9:_-]{1,128}', args['operation_id']))
        self.assertEqual(args['expected_' + field], self.remote[field])
        self.writes.append(args.copy())
        if self.fail_before_commit:
            raise server.Problem(503, 'offline', 'simulated unavailable service')
        self.remote[field] = args[field]
        return self.remote.copy()

    def mark(self, **data):
        field = 'is_favorite' if 'favorite' in data else 'mastery'
        return self.bridge.mark(dict(key=self.key, id=self.qid, connectionId='test', **data), field)

    def test_unknown_outcome_and_retries(self):
        self.fail_before_commit = True
        change = dict(expected='u', status='P', operationId='edit-1')
        with self.assertRaises(server.Problem):
            self.mark(**change)
        self.fail_before_commit = False
        self.assertEqual(self.mark(**change)['status'], 'P')
        self.assertEqual(self.writes[0], self.writes[1])
        self.assertEqual(self.mark(**change)['status'], 'P')
        self.assertEqual(len(self.writes), 2)
        with self.assertRaises(server.Problem) as conflict:
            self.mark(expected='u', status='M', operationId='other-edit')
        self.assertEqual(conflict.exception.status, 409)
        self.assertEqual(len(self.writes), 2)

    def test_distinct_intents_and_old_clients(self):
        self.mark(expected='u', status='M', operationId='edit-1')
        self.mark(expected=False, favorite=True, operationId='edit-1')
        self.mark(expected='M', status='P', operationId='edit-1')
        self.mark(expected='P', status='u')
        self.mark(expected='u', status='M', operationId='edit-2')
        self.assertEqual(len({args['operation_id'] for args in self.writes}), 5)
        self.assertIs(self.remote['is_favorite'], True)


if __name__ == '__main__':
    unittest.main()
