Title: Adding repository custom instructions for GitHub Copilot - GitHub Docs

URL Source: https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions

Final URL: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions

Markdown Content:
Create repository custom instructions files that give Copilot additional context on how to understand your project and how to build, test and validate its changes.

## [Introduction](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#introduction)

Repository custom instructions let you provide Copilot with repository-specific guidance and preferences on GitHub. To find out how to set up custom instructions in an IDE, see [Adding repository custom instructions for GitHub Copilot in your IDE](https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/configure-custom-instructions/add-repository-instructions-in-your-ide). For more information about custom instructions, see [Custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/concepts/prompting-and-context/custom-instructions).

## [Prerequisites for repository custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#prerequisites-for-repository-custom-instructions)

*   You must have a custom instructions file (see the instructions below).

*   For Copilot code review, your personal choice of whether to use custom instructions must be set to enabled. This is enabled by default. See [Enabling or disabling repository custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#enabling-or-disabling-custom-instructions-for-copilot-code-review) later in this article.

## [Creating custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#creating-custom-instructions)

Copilot on GitHub supports three types of repository custom instructions. For details of which GitHub Copilot features support these types of instructions, see [Custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/concepts/prompting-and-context/custom-instructions#repository-custom-instructions-across-clients-and-surfaces).

*   **Repository-wide custom instructions** apply to all requests made in the context of a repository.

These are specified in a `copilot-instructions.md` file in the `.github` directory of the repository. See [Creating repository-wide custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#creating-repository-wide-custom-instructions).

*   **Path-specific custom instructions** apply to requests made in the context of files that match a specified path.

These are specified in one or more `NAME.instructions.md` files within or below the `.github/instructions` directory in the repository. See [Creating path-specific custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#creating-path-specific-custom-instructions).

If the path you specify matches a file that Copilot is working on, and a repository-wide custom instructions file also exists, then the instructions from both files are used.

*   **Agent instructions** are used by AI agents.

You can create one or more `AGENTS.md` files, stored anywhere within the repository. When Copilot is working, the nearest `AGENTS.md` file in the directory tree will take precedence. For more information, see the [agentsmd/agents.md repository](https://github.com/agentsmd/agents.md).

Alternatively, you can use a single `CLAUDE.md` or `GEMINI.md` file stored in the root of the repository.

## [Creating repository-wide custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#creating-repository-wide-custom-instructions)

You can create your own custom instructions file from scratch. See [Writing your own copilot-instructions.md file](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#writing-your-own-copilot-instructionsmd-file). Alternatively, you can ask Copilot cloud agent to generate one for you.

### [Asking Copilot cloud agent to generate a `copilot-instructions.md` file](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#asking-copilot-cloud-agent-to-generate-a-copilot-instructionsmd-file)

1.   Go to the agents tab at [github.com/copilot/agents](https://github.com/copilot/agents?ref_product=copilot&ref_type=engagement&ref_style=text).

You can also reach this page by clicking the  button next to the search bar on any page on GitHub, then selecting **Agents** from the sidebar.

2.   In the prompt field dropdown, select the repository you want Copilot to generate custom instructions for.

3.   Copy the following prompt and paste it into the prompt field, customizing it if needed:

Markdown
```
Your task is to "onboard" this repository to Copilot cloud agent by adding a .github/copilot-instructions.md file in the repository that contains information describing how a cloud agent seeing it for the first time can work most efficiently.

You will do this task only one time per repository and doing a good job can SIGNIFICANTLY improve the quality of the agent's work, so take your time, think carefully, and search thoroughly before writing the instructions.

<Goals>
- Reduce the likelihood of a cloud agent pull request getting rejected by the user due to
generating code that fails the continuous integration build, fails a validation pipeline, or
having misbehavior.
- Minimize bash command and build failures.
- Allow the agent to complete its task more quickly by minimizing the need for exploration using grep, find, str_replace_editor, and code search tools.
</Goals>

<Limitations>
- Instructions must be no longer than 2 pages.
- Instructions must not be task specific.
</Limitations>

<WhatToAdd>

Add the following high level details about the codebase to reduce the amount of searching the agent has to do to understand the codebase each time:
<HighLevelDetails>

- A summary of what the repository does.
- High level repository information, such as the size of the repo, the type of the project, the languages, frameworks, or target runtimes in use.
</HighLevelDetails>

Add information about how to build and validate changes so the agent does not need to search and find it each time.
<BuildInstructions>

- For each of bootstrap, build, test, run, lint, and any other scripted step, document the sequence of steps to take to run it successfully as well as the versions of any runtime or build tools used.
- Each command should be validated by running it to ensure that it works correctly as well as any preconditions and postconditions.
- Try cleaning the repo and environment and running commands in different orders and document errors and misbehavior observed as well as any steps used to mitigate the problem.
- Run the tests and document the order of steps required to run the tests.
- Make a change to the codebase. Document any unexpected build issues as well as the workarounds.
- Document environment setup steps that seem optional but that you have validated are actually required.
- Document the time required for commands that failed due to timing out.
- When you find a sequence of commands that work for a particular purpose, document them in detail.
- Use language to indicate when something should always be done. For example: "always run npm install before building".
- Record any validation steps from documentation.
</BuildInstructions>

List key facts about the layout and architecture of the codebase to help the agent find where to make changes with minimal searching.
<ProjectLayout>

- A description of the major architectural elements of the project, including the relative paths to the main project files, the location
of configuration files for linting, compilation, testing, and preferences.
- A description of the checks run prior to check in, including any GitHub workflows, continuous integration builds, or other validation pipelines.
- Document the steps so that the agent can replicate these itself.
- Any explicit validation steps that the agent can consider to have further confidence in its changes.
- Dependencies that aren't obvious from the layout or file structure.
- Finally, fill in any remaining space with detailed lists of the following, in order of priority: the list of files in the repo root, the
contents of the README, the contents of any key source files, the list of files in the next level down of directories, giving priority to the more structurally important and snippets of code from key source files, such as the one containing the main method.
</ProjectLayout>
</WhatToAdd>

<StepsToFollow>
- Perform a comprehensive inventory of the codebase. Search for and view:
- README.md, CONTRIBUTING.md, and all other documentation files.
- Search the codebase for build steps and indications of workarounds like 'HACK', 'TODO', etc.
- All scripts, particularly those pertaining to build and repo or environment setup.
- All build and actions pipelines.
- All project files.
- All configuration and linting files.
- For each file:
- think: are the contents or the existence of the file information that the cloud agent will need to implement, build, test, validate, or demo a code change?
- If yes:
   - Document the command or information in detail.
   - Explicitly indicate which commands work and which do not and the order in which commands should be run.
   - Document any errors encountered as well as the steps taken to workaround them.
- Document any other steps or information that the agent can use to reduce time spent exploring or trying and failing to run bash commands.
- Finally, explicitly instruct the agent to trust the instructions and only perform a search if the information in the instructions is incomplete or found to be in error.
</StepsToFollow>
   - Document any errors encountered as well as the steps taken to work-around them.
``` 
4.   Click  or press Enter.

Copilot will start a new session, which will appear in the list below the prompt box. Copilot will create a draft pull request, write your custom instructions, push them to the branch, then add you as a reviewer when finished, triggering a notification.

### [Writing your own `copilot-instructions.md` file](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#writing-your-own-copilot-instructionsmd-file)

1.   In the root of your repository, create a file named `.github/copilot-instructions.md`.

Create the `.github` directory if it does not already exist.

2.   Add natural language instructions to the file, in Markdown format.

Whitespace between instructions is ignored, so the instructions can be written as a single paragraph, each on a new line, or separated by blank lines for legibility.

Tip

The first time you create a pull request in a given repository with Copilot cloud agent, Copilot will leave a comment with a link to automatically generate custom instructions for the repository.

## [Creating path-specific custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#creating-path-specific-custom-instructions)

Note

Currently, on GitHub.com, path-specific custom instructions are only supported for Copilot cloud agent and Copilot code review.

1.   Create the `.github/instructions` directory if it does not already exist.

2.   Optionally, create subdirectories of `.github/instructions` to organize your instruction files.

3.   Create one or more `NAME.instructions.md` files, where `NAME` indicates the purpose of the instructions. The file name must end with `.instructions.md`.

4.   At the start of the file, create a frontmatter block containing the `applyTo` keyword. Use glob syntax to specify what files or directories the instructions apply to.

For example:

```
---
applyTo: "app/models/**/*.rb"
---
```

You can specify multiple patterns by separating them with commas. For example, to apply the instructions to all TypeScript files in the repository, you could use the following frontmatter block:

```
---
applyTo: "**/*.ts,**/*.tsx"
---
```

Glob examples:

    *   `*` - will all match all files in the current directory.
    *   `**` or `**/*` - will all match all files in all directories.
    *   `*.py` - will match all `.py` files in the current directory.
    *   `**/*.py` - will recursively match all `.py` files in all directories.
    *   `src/*.py` - will match all `.py` files in the `src` directory. For example, `src/foo.py` and `src/bar.py` but _not_`src/foo/bar.py`.
    *   `src/**/*.py` - will recursively match all `.py` files in the `src` directory. For example, `src/foo.py`, `src/foo/bar.py`, and `src/foo/bar/baz.py`.
    *   `**/subdir/**/*.py` - will recursively match all `.py` files in any `subdir` directory at any depth. For example, `subdir/foo.py`, `subdir/nested/bar.py`, `parent/subdir/baz.py`, and `deep/parent/subdir/nested/qux.py`, but _not_`foo.py` at a path that does not contain a `subdir` directory.

5.   Optionally, to prevent the file from being used by either Copilot cloud agent or Copilot code review, add the `excludeAgent` keyword to the frontmatter block. Use either `"code-review"` or `"cloud-agent"`.

For example, the following file will only be read by Copilot cloud agent.

```
---
applyTo: "**"
excludeAgent: "code-review"
---
```

If the `excludeAgent` keyword is not included in the front matterblock, both Copilot code review and Copilot cloud agent will use your instructions.

6.   Add your custom instructions in natural language, using Markdown format. Whitespace between instructions is ignored, so the instructions can be written as a single paragraph, each on a new line, or separated by blank lines for legibility.

Did you successfully add a custom instructions file to your repository?

[Yes](https://docs.github.io/success-test/yes.html)[No](https://docs.github.io/success-test/no.html)

## [Custom instructions in use](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#custom-instructions-in-use)

The instructions in the file(s) are available for use by Copilot as soon as you save the file(s). Instructions are automatically added to requests that you submit to Copilot.

In Copilot Chat ([github.com/copilot](https://github.com/copilot)), you can start a conversation that uses repository custom instructions by adding, as an attachment, the repository that contains the instructions file.

Whenever repository custom instructions are used by Copilot Chat, the instructions file is added as a reference for the response that's generated. To find out whether repository custom instructions were used, expand the list of references at the top of a chat response in the Chat panel and check whether the `.github/copilot-instructions.md` file is listed.

![Image 1: Screenshot of an expanded References list, showing the 'copilot-instructions.md' file highlighted with a dark orange outline.](https://docs.github.com/assets/cb-42321/images/help/copilot/custom-instructions-ref-in-github.png)

You can click the reference to open the file.

Note

*   Multiple types of custom instructions can apply to a request sent to Copilot. Personal instructions take the highest priority. Repository instructions come next, and then organization instructions are prioritized last. However, all sets of relevant instructions are provided to Copilot.
*   Whenever possible, try to avoid providing conflicting sets of instructions. If you are concerned about response quality, you can temporarily disable repository instructions. See [Adding repository custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions?tool=webui).

## [Enabling or disabling custom instructions for Copilot code review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#enabling-or-disabling-custom-instructions-for-copilot-code-review)

Custom instructions are enabled for Copilot code review by default but you can disable, or re-enable, them in the repository settings on GitHub.com. This applies to Copilot's use of custom instructions for all code reviews it performs in this repository.

1.   On GitHub, navigate to the main page of the repository.

2.   Under your repository name, click **Settings**. If you cannot see the "Settings" tab, select the  dropdown menu, then click **Settings**.

![Image 2: Screenshot of a repository header showing the tabs. The "Settings" tab is highlighted by a dark orange outline.](https://docs.github.com/assets/cb-28260/images/help/repository/repo-actions-settings.png)

3.   In the sidebar, under "Code, planning, and automation", click **Copilot**, then **Code review**.

4.   Toggle the “Use custom instructions when reviewing pull requests” option on or off.

Note

When reviewing a pull request, Copilot reads repository custom instructions, agent instructions, and agent skills from the head branch (the branch with your changes), not the base branch. For example, when merging `my-feature-branch` into `main`, Copilot uses the instructions and skills in `my-feature-branch`, so you can test changes to them in the same pull request without merging them first.

## [Further reading](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions#further-reading)

*   [Support for different types of custom instructions](https://docs.github.com/en/copilot/reference/custom-instructions-support)
*   [Custom instructions](https://docs.github.com/en/copilot/tutorials/customization-library/custom-instructions)—a curated collection of examples
*   [Using custom instructions to unlock the power of Copilot code review](https://docs.github.com/en/copilot/tutorials/customize-code-review)
