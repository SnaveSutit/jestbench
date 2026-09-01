/**
 * Example Blockbench plugin under test.
 *
 * It registers one action that adds a cube to the current project, puts that
 * action in the Filter menu, and exposes a small dialog. The test suite in
 * hello.test.ts drives all of it.
 */
;(function () {
	let greetAction
	let dialogAction

	BBPlugin.register('hello_world', {
		title: 'Hello World',
		author: 'jestbench',
		description: 'Adds a friendly cube to your project.',
		icon: 'waving_hand',
		version: '1.0.0',
		variant: 'both',
		onload() {
			greetAction = new Action('hello_world_greet', {
				name: 'Add Greeting Cube',
				description: 'Adds a 1x1x1 cube called "Greeting" to the project',
				icon: 'waving_hand',
				condition: () => Boolean(Project),
				click() {
					Undo.initEdit({ elements: [], outliner: true })
					const cube = new Cube({ name: 'Greeting' }).init()
					cube.extend({ from: [0, 0, 0], to: [1, 1, 1] })
					Undo.finishEdit('Add greeting cube', { elements: [cube], outliner: true })
				},
			})

			dialogAction = new Action('hello_world_open_dialog', {
				name: 'Open Hello Dialog',
				icon: 'chat',
				click() {
					new Dialog('hello_world_dialog', {
						title: 'Hello World',
						form: {
							greeting: { label: 'Greeting', type: 'text', value: 'Hello' },
						},
						onConfirm(result) {
							Blockbench.showQuickMessage(`${result.greeting}!`)
							this.close()
						},
					}).show()
				},
			})

			MenuBar.addAction(greetAction, 'filter')
		},
		onunload() {
			greetAction?.delete()
			dialogAction?.delete()
			MenuBar.removeAction('filter.hello_world_greet')
		},
	})
})()
